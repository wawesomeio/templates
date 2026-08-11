import { describe, expect, it, vi } from "vitest";
import { eventStream, formatEvent, readDataEvents } from "./sse.js";

/** A provider body, delivered in exactly the network chunks given. */
function body(...pieces: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
}

async function collect(events: AsyncIterable<string>): Promise<string[]> {
  const seen: string[] = [];
  for await (const event of events) seen.push(event);
  return seen;
}

describe("readDataEvents", () => {
  it("yields the payload of each data line", async () => {
    const events = readDataEvents(body('data: {"a":1}\n\n', 'data: {"a":2}\n\n'));

    await expect(collect(events)).resolves.toEqual(['{"a":1}', '{"a":2}']);
  });

  it("reassembles a payload split across network chunks", async () => {
    // The provider writes events; the socket delivers bytes. A frame arriving in
    // three reads is the normal case, not the pathological one.
    const events = readDataEvents(body('data: {"hel', 'lo":"wo', 'rld"}\n\n'));

    await expect(collect(events)).resolves.toEqual(['{"hello":"world"}']);
  });

  it("stops at the terminator and never yields it", async () => {
    const events = readDataEvents(body('data: {"a":1}\n\ndata: [DONE]\n\ndata: {"a":2}\n\n'));

    await expect(collect(events)).resolves.toEqual(['{"a":1}']);
  });

  it("ignores the comment lines a provider sends to keep the connection alive", async () => {
    const events = readDataEvents(body(': keep-alive\n\ndata: {"a":1}\n\n'));

    await expect(collect(events)).resolves.toEqual(['{"a":1}']);
  });

  it("joins the data lines of one event, as the event-stream format defines it", async () => {
    const events = readDataEvents(body("data: first\ndata: second\n\n"));

    await expect(collect(events)).resolves.toEqual(["first\nsecond"]);
  });

  it("reads a provider that frames with CRLF", async () => {
    const events = readDataEvents(body('data: {"a":1}\r\n\r', '\ndata: {"a":2}\r\n\r\n'));

    await expect(collect(events)).resolves.toEqual(['{"a":1}', '{"a":2}']);
  });

  it("keeps a last event the provider did not terminate with a blank line", async () => {
    await expect(collect(readDataEvents(body('data: {"a":1}')))).resolves.toEqual(['{"a":1}']);
  });

  it("stops reading the provider when the consumer stops reading it", async () => {
    const cancel = vi.fn();
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"a":1}\n\ndata: {"a":2}\n\n'));
      },
      cancel,
    });

    for await (const _ of readDataEvents(source)) break;

    expect(cancel).toHaveBeenCalled();
  });
});

describe("formatEvent", () => {
  it("names the event and terminates it, so a browser can dispatch on the name", () => {
    expect(formatEvent("delta", { text: "hello" })).toBe('event: delta\ndata: {"text":"hello"}\n\n');
  });

  it("keeps a payload containing newlines on a single data line", () => {
    // A raw newline inside a payload would split it into two events. JSON
    // escapes them, which is the whole reason the payload is JSON.
    expect(formatEvent("delta", { text: "one\ntwo" })).toBe('event: delta\ndata: {"text":"one\\ntwo"}\n\n');
  });

  it("stays readable by the twenty-line reader in the README", () => {
    // That snippet is the template's promise, and it is prose no test can run:
    // it splits on a literal "\n\n" and matches one `data:` line. A second data
    // line or a CRLF here would break every copy of it already pasted into a
    // frontend, silently and only at runtime.
    const event = formatEvent("delta", { text: "one\ntwo" });

    expect(event.endsWith("\n\n")).toBe(true);
    expect(event).not.toContain("\r");

    const [frame] = event.split("\n\n");
    expect(frame.match(/^event: (.*)$/m)?.[1]).toBe("delta");
    expect(JSON.parse(frame.match(/^data: (.*)$/m)![1])).toEqual({ text: "one\ntwo" });
  });
});

describe("eventStream", () => {
  it("encodes one event per read, so nothing waits for the last one", async () => {
    async function* events() {
      yield "first\n\n";
      yield "second\n\n";
    }

    const reader = eventStream(events()).getReader();
    const decoder = new TextDecoder();

    await expect(reader.read().then(({ value }) => decoder.decode(value))).resolves.toBe("first\n\n");
    await expect(reader.read().then(({ value }) => decoder.decode(value))).resolves.toBe("second\n\n");
    await expect(reader.read().then(({ done }) => done)).resolves.toBe(true);
  });

  it("tells the source it is over when the caller hangs up", async () => {
    const ended = vi.fn();
    async function* events() {
      try {
        yield "first\n\n";
        yield "second\n\n";
      } finally {
        ended();
      }
    }

    const stream = eventStream(events());
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();

    expect(ended).toHaveBeenCalled();
  });
});

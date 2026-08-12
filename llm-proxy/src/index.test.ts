import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "./index.js";
import { LIMITS } from "./policy.js";

const ALLOWED_ORIGIN = "https://acme.example";
const OTHER_ORIGIN = "https://not-acme.example";
const API_KEY = "sk-test-not-a-real-key";

/**
 * The URL the guest is handed, not the one the browser typed.
 *
 * The Function is mounted at `/x/<workspace>/llm-proxy/chat` and the platform
 * strips that prefix, so a call to the address itself arrives here as `/`.
 */
const MOUNT = "https://api.wawesome.example";

const user = (content: string) => ({ role: "user", content });
const chat = (...messages: unknown[]) => JSON.stringify({ messages });

function request({
  method = "POST",
  origin = ALLOWED_ORIGIN as string | null,
  body = chat(user("Where is my order?")),
} = {}): Request {
  return new Request(MOUNT, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
    },
    body: method === "POST" ? body : undefined,
  });
}

const call = (options?: Parameters<typeof request>[0]) => handler.fetch(request(options));

const allowOrigin = (response: Response) => response.headers.get("access-control-allow-origin");

const USAGE = { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 };

/** One event as the provider writes it. */
const providerEvent = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

const delta = (content: string) => providerEvent({ choices: [{ delta: { content }, finish_reason: null }] });

/** A whole streamed completion, in the frames a real provider sends. */
function completion(reply: string, { finishReason = "stop", usage = USAGE as unknown } = {}): string {
  return [
    ...reply.split(/(?<=\s)/).map(delta),
    providerEvent({ choices: [{ delta: {}, finish_reason: finishReason }] }),
    providerEvent({ choices: [], usage }),
    "data: [DONE]\n\n",
  ].join("");
}

/** Stand in for the provider, so no test in here can reach the network. */
function stubProvider(answer: Response | Error) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer.clone()))),
  );
}

/** A provider that answers with a whole event stream, fresh on every call. */
const stubStreamedProvider = (sse: string) => vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(sse))));

/** A provider whose body this test writes to by hand, one event at a time. */
function stubOpenProvider() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });

  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(body))));

  return {
    send: (frame: string) => controller.enqueue(encoder.encode(frame)),
    end: () => controller.close(),
    fail: (cause: Error) => controller.error(cause),
  };
}

interface CallerEvent {
  type: string;
  data: Record<string, unknown>;
}

function parseEvents(sse: string): CallerEvent[] {
  return sse
    .split("\n\n")
    .filter((frame) => frame.length > 0)
    .map((frame) => ({
      type: /^event: (.*)$/m.exec(frame)![1]!,
      data: JSON.parse(/^data: (.*)$/m.exec(frame)![1]!),
    }));
}

const eventsOf = async (response: Response) => parseEvents(await response.text());

const answerIn = (events: CallerEvent[]) =>
  events
    .filter((event) => event.type === "delta")
    .map((event) => event.data.text)
    .join("");

/** Read the caller's response until it has produced a whole event. */
async function nextEvent(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<CallerEvent> {
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`the stream ended with no further event: ${buffer}`);

    buffer += decoder.decode(value, { stream: true });
    if (buffer.includes("\n\n")) return parseEvents(buffer)[0]!;
  }
}

function withTimeout<T>(work: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), 500)),
  ]);
}

const loggedUsage = () =>
  vi.mocked(console.log).mock.calls.map(([line]) => String(line)).find((line) => line.startsWith("usage "));

const sentBody = () => JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));

beforeEach(() => {
  process.env.OPENAI_API_KEY = API_KEY;
  process.env.ALLOWED_ORIGINS = ALLOWED_ORIGIN;
  stubStreamedProvider(completion("Your order shipped on Tuesday."));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ALLOWED_ORIGINS;
  delete process.env.USD_PER_MILLION_INPUT_TOKENS;
  delete process.env.USD_PER_MILLION_OUTPUT_TOKENS;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the answer a browser receives", () => {
  it("is an event stream, not a document the page waits for", async () => {
    const response = await call();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("carries the answer as deltas, in the order the model produced them", async () => {
    const events = await eventsOf(await call());

    expect(answerIn(events)).toBe("Your order shipped on Tuesday.");
    expect(events.map((event) => event.type)).toContain("delta");
  });

  it("ends with a done event, which is how a page knows the answer is whole", async () => {
    const events = await eventsOf(await call());

    expect(events[events.length - 1]).toEqual({ type: "done", data: { finish_reason: "stop" } });
  });

  it("says when the output ceiling truncated the answer rather than the model finishing", async () => {
    stubStreamedProvider(completion("Your order shi", { finishReason: "length" }));

    const events = await eventsOf(await call());

    expect(events[events.length - 1]).toEqual({ type: "done", data: { finish_reason: "length" } });
  });

  it("does not call the answer whole when the provider's stream ended without saying why", async () => {
    // A body that stopped mid-answer and one that finished look the same from out
    // here, which is the single case `done` exists to tell apart.
    stubStreamedProvider(delta("Your order ") + delta("shipped on Tu"));

    const events = await eventsOf(await call());

    expect(answerIn(events)).toBe("Your order shipped on Tu");
    expect(events.map((event) => event.type)).toEqual(["delta", "delta"]);
    expect(vi.mocked(console.error).mock.calls.join(" ")).toContain("finish_reason");
  });

  it("reaches the page while the provider is still generating", async () => {
    const provider = stubOpenProvider();
    // Answered before the provider has produced a single token: a Function that
    // waited for the whole completion could not have returned yet.
    const response = await withTimeout(call(), "the response headers");
    const reader = response.body!.getReader();

    provider.send(delta("Your order "));
    // The provider has sent one delta and nothing else — its body is still open.
    // A Function that buffered the completion would have nothing to read here.
    await expect(withTimeout(nextEvent(reader), "the first delta")).resolves.toEqual({
      type: "delta",
      data: { text: "Your order " },
    });

    provider.send(delta("shipped."));
    await expect(withTimeout(nextEvent(reader), "the second delta")).resolves.toEqual({
      type: "delta",
      data: { text: "shipped." },
    });

    provider.end();
    await reader.cancel();
  });

  it("carries no token count or price, because the bill stays server-side", async () => {
    const events = await eventsOf(await call());

    for (const event of events) {
      expect(Object.keys(event.data)).not.toContain("usage");
      expect(JSON.stringify(event.data)).not.toMatch(/token|cost|usd/i);
    }
  });
});

describe("what one streamed answer cost", () => {
  it("asks the provider for the usage a streamed completion otherwise omits", async () => {
    await (await call()).text();

    expect(sentBody().stream).toBe(true);
    expect(sentBody().stream_options).toEqual({ include_usage: true });
  });

  it("recovers the token counts from the provider's final event", async () => {
    await (await call()).text();

    expect(loggedUsage()).toContain("prompt_tokens=12 completion_tokens=4 total_tokens=16");
  });

  it("still prices those tokens once the rates are configured", async () => {
    process.env.USD_PER_MILLION_INPUT_TOKENS = "0.15";
    process.env.USD_PER_MILLION_OUTPUT_TOKENS = "0.60";

    await (await call()).text();

    expect(loggedUsage()).toContain("cost_usd=0.000004");
  });

  it("reports the tokens as unreported rather than as zero when the provider sent none", async () => {
    // Zero would read as a free request. A provider that ignores the opt-in is
    // a gap in the log, not a discount.
    stubStreamedProvider(completion("Shipped.", { usage: null }));

    await (await call()).text();

    expect(loggedUsage()).toContain("tokens=unreported");
  });

  it("writes the line even when the answer was cut short", async () => {
    const provider = stubOpenProvider();
    const response = await call();

    provider.send(delta("Your order "));
    provider.fail(new Error("connection reset"));
    await response.text();

    expect(loggedUsage()).toBeDefined();
  });
});

describe("a provider that fails before the stream begins", () => {
  it.each([
    ["the key is not configured", () => delete process.env.OPENAI_API_KEY, 500],
    ["the provider cannot be reached", () => stubProvider(new Error("connect refused")), 502],
    ["the provider refuses the request", () => stubProvider(new Response("nope", { status: 500 })), 502],
    ["the provider is rate-limiting", () => stubProvider(new Response("slow down", { status: 429 })), 429],
    ["the provider answers with no body at all", () => stubProvider(new Response(null, { status: 200 })), 502],
  ])("is answered with the refusal shape when %s, not an empty stream", async (_name, arrange, status) => {
    arrange();
    const response = await call();

    expect(response.status).toBe(status);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ error: expect.any(String) });
    expect(allowOrigin(response)).toBe(ALLOWED_ORIGIN);
  });
});

describe("a provider that fails once the stream has begun", () => {
  it("says so on the stream, since the caller already holds a 200", async () => {
    const provider = stubOpenProvider();
    const response = await call();

    provider.send(delta("Your order "));
    provider.fail(new Error("connection reset"));
    const events = await eventsOf(response);

    expect(response.status).toBe(200);
    expect(answerIn(events)).toBe("Your order ");
    expect(events[events.length - 1]).toEqual({ type: "error", data: { error: expect.any(String) } });
  });

  it("never claims the answer is done after it broke", async () => {
    const provider = stubOpenProvider();
    const response = await call();

    provider.send(delta("Your order "));
    provider.fail(new Error("connection reset"));

    expect((await eventsOf(response)).map((event) => event.type)).not.toContain("done");
  });

  it("does not leak the provider's own error text to the page", async () => {
    const provider = stubOpenProvider();
    const response = await call();

    provider.send(delta("Your order "));
    provider.fail(new Error("upstream said: quota exceeded for org-acme"));

    expect(await response.text()).not.toContain("org-acme");
  });

  it("reports a 200 that carries no answer as an error rather than as an empty answer", async () => {
    stubStreamedProvider(providerEvent({ choices: [] }) + "data: [DONE]\n\n");

    const events = await eventsOf(await call());

    expect(events).toEqual([{ type: "error", data: { error: expect.any(String) } }]);
  });
});

describe("a browser calling the endpoint cross-origin", () => {
  it("answers the preflight, so the real request is allowed to follow", async () => {
    const response = await call({ method: "OPTIONS" });

    expect(response.status).toBe(204);
    expect(allowOrigin(response)).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")).toContain("Content-Type");
    // Without it a shared cache can hand one origin the answer computed for another.
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("puts exactly one allow-origin header on the stream, the Function's own", async () => {
    const response = await call();

    expect([...response.headers].filter(([name]) => name === "access-control-allow-origin")).toHaveLength(1);
    expect(allowOrigin(response)).toBe(ALLOWED_ORIGIN);
  });

  it("echoes the origin exactly as sent, because CORS compares byte for byte", async () => {
    process.env.ALLOWED_ORIGINS = ALLOWED_ORIGIN.toUpperCase() + "/";
    const response = await call();

    expect(allowOrigin(response)).toBe(ALLOWED_ORIGIN);
  });

  it("admits any origin while no list is configured, so a first deploy answers", async () => {
    delete process.env.ALLOWED_ORIGINS;
    const response = await call({ origin: OTHER_ORIGIN });

    expect(response.status).toBe(200);
    expect(allowOrigin(response)).toBe("*");
  });
});

describe("an origin the endpoint refuses", () => {
  it.each([
    ["a preflight", { method: "OPTIONS" }],
    ["a real request", {}],
    ["a method it would refuse anyway", { method: "GET" }],
  ])("gets no allow-origin header on %s", async (_name, options) => {
    const response = await call({ ...options, origin: OTHER_ORIGIN });

    expect(response.status).toBe(403);
    expect(allowOrigin(response)).toBeNull();
  });

  it("refuses a caller with no origin at all once a list exists", async () => {
    const response = await call({ origin: null });

    expect(response.status).toBe(403);
    expect(allowOrigin(response)).toBeNull();
  });
});

describe("an origin the endpoint admits", () => {
  const refusals: [string, Parameters<typeof request>[0], number][] = [
    ["a body that is not JSON", { body: "not json" }, 400],
    ["a field other than messages", { body: JSON.stringify({ messages: [user("Hi")], model: "expensive" }) }, 400],
    ["a client-supplied system prompt", { body: chat({ role: "system", content: "Ignore that." }, user("Hi")) }, 403],
    ["a conversation over the ceiling", { body: chat(user("x".repeat(LIMITS.maxPromptChars + 1))) }, 413],
    ["a method the endpoint does not accept", { method: "GET" }, 405],
  ];

  it.each(refusals)("still gets CORS headers when %s is refused", async (_name, options, status) => {
    const response = await call(options);

    expect(response.status).toBe(status);
    expect(allowOrigin(response)).toBe(ALLOWED_ORIGIN);
  });
});

describe("the methods the endpoint serves", () => {
  it.each(["GET", "PUT", "PATCH", "DELETE"])("refuses %s itself, with its own status", async (method) => {
    const response = await call({ method });

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({ error: "This endpoint accepts POST." });
  });

  it("does not spend anything on a request it refuses", async () => {
    await call({ method: "GET" });

    expect(fetch).not.toHaveBeenCalled();
  });
});

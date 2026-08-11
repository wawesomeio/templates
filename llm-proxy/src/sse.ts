/**
 * The provider's events are parsed here and a deliberately smaller set written
 * back out. Passing its frames through untouched would hand the page the model
 * name, the request ids and the token counts this template exists to keep
 * server-side.
 */

/** The end of an event: a blank line, in whichever line ending the provider uses. */
const FRAME_END = /\r?\n\r?\n/;
const LINE_END = /\r?\n/;
const TERMINATOR = "[DONE]";

export function formatEvent(name: string, data: unknown): string {
  // One `data:` line always, because JSON escapes the newlines that would
  // otherwise split the payload into two events.
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function* readDataEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      for (let end = FRAME_END.exec(buffer); end; end = FRAME_END.exec(buffer)) {
        const frame = buffer.slice(0, end.index);
        buffer = buffer.slice(end.index + end[0].length);

        const data = dataOf(frame);
        if (data === TERMINATOR) return;
        if (data) yield data;
      }
    }

    // Providers that close the body straight after the last event rather than
    // after a final blank line are common enough to read rather than refuse.
    const last = dataOf(buffer);
    if (last && last !== TERMINATOR) yield last;
  } finally {
    // Reached on an early `return` too: a caller that stopped listening is a
    // reason to stop paying the provider to keep talking. Not awaited — tearing
    // a socket down is the provider's business, and the answer already given to
    // the browser must not wait on it.
    void reader.cancel().catch(() => {});
  }
}

function dataOf(frame: string): string | null {
  const data = frame
    .split(LINE_END)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).replace(/^ /, ""))
    .join("\n");

  return data.length > 0 ? data : null;
}

export function eventStream(events: AsyncIterable<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = events[Symbol.asyncIterator]();

  // One event per `pull` rather than a loop that races ahead: the source is a
  // provider being paid by the token, so it is read at the speed the caller is
  // being written to and not faster.
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(value));
    },
    async cancel() {
      await iterator.return?.(undefined);
    },
  });
}

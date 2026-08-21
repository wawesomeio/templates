import { renderToReadableStream } from "react-dom/server.browser";
import { describe, expect, it } from "vitest";
import { loadActivity } from "./Activity.js";
import { App } from "./App.js";

/** Render the page the way the handler does, and collect it in arrival order. */
async function render(base: string): Promise<string[]> {
  const stream = await renderToReadableStream(
    <App base={base} address={`${base}/`} activity={loadActivity()} />,
  );

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const pieces: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pieces.push(decoder.decode(value, { stream: true }));
  }
  return pieces;
}

describe("the page", () => {
  it("puts the mount it was rendered under on every URL it writes", async () => {
    const markup = (await render("/storefront")).join("");

    expect(markup).toContain('src="/storefront/wawesome.svg"');
    expect(markup).not.toContain('src="/wawesome.svg"');
  });

  it("writes root-relative URLs when there is no mount to strip", async () => {
    expect((await render("")).join("")).toContain('src="/wawesome.svg"');
  });

  /**
   * The shell has to be on the wire before the awaited section resolves —
   * otherwise the boundary is decoration and the page is as slow as its slowest
   * query.
   */
  it("commits the header before the awaited section is ready", async () => {
    const pieces = await render("");
    const shell = pieces.findIndex((piece) => piece.includes("Rendered on the server"));
    const deferred = pieces.findIndex((piece) => piece.includes("Version 7 promoted"));

    expect(shell).toBeGreaterThanOrEqual(0);
    expect(deferred).toBeGreaterThan(shell);
    expect(pieces[shell]).toContain("Still loading");
  });
});

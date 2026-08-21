import { renderToReadableStream } from "react-dom/server.browser";
import { baseScript, clientEntry, documentShell } from "virtual:wawesome/document";
import { loadActivity } from "./Activity.js";
import { App } from "./App.js";
import { assetUrl, baseOf, callerUrl } from "./mount.js";

export default {
  async fetch(request: Request): Promise<Response> {
    const base = baseOf(request);

    // Started before rendering, so the wait overlaps the shell rather than
    // following it.
    const activity = loadActivity();

    // Nothing is caught here on purpose. A component that throws while the
    // shell is rendering rejects this promise *before* any of the response has
    // been committed, so the caller gets a whole, framed 500 rather than a body
    // abandoned part-way, and the stack is in `wawesome logs` under the
    // invocation id on that same response. Catching it to render an error page
    // is a fine thing to do — put the boundary in the component tree, where it
    // can say something useful, rather than here.
    //
    // A boundary that fails *after* the shell is committed is React's to
    // recover from in the browser, and reaches the platform as an ordinary
    // successful run — which is the right division of labour.
    const rendered = await renderToReadableStream(
      <App base={base} address={callerUrl(request)} activity={activity} />,
      {
        // Built here rather than baked into the client bundle: this is the one
        // place that knows which prefix the platform stripped off this request.
        bootstrapModules: [assetUrl(base, clientEntry)],
        // The same string, handed to the browser so hydration resolves its own
        // URLs against exactly what the server rendered against.
        bootstrapScriptContent: baseScript(base),
        onError(error) {
          console.error(error);
        },
      },
    );

    const { before, after } = documentShell(base);
    return new Response(wrap(rendered, before, after), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        // The document is this request's; its assets are immutable and cached
        // for a year by the platform that serves them.
        "cache-control": "no-store",
      },
    });
  },
};

/**
 * The document around React's stream, sent as three pieces rather than joined.
 *
 * The head goes out first and by itself, so the browser has the title, the
 * stylesheet and the viewport while the application is still rendering.
 */
function wrap(rendered: ReadableStream<Uint8Array>, before: string, after: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const reader = rendered.getReader();

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(before));
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.enqueue(encoder.encode(after));
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

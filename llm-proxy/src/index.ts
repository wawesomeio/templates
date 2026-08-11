import type OpenAI from "openai";
import { LIMITS, checkOrigin, parseAllowedOrigins, parseChatRequest, type Refusal } from "./policy.js";
import { eventStream, formatEvent, readDataEvents } from "./sse.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { type TokenUsage, readPricing, readUsage, usageLine } from "./usage.js";

/**
 * An LLM proxy your frontend can call.
 *
 * The model call itself is the least interesting thing here — it is one `fetch`.
 * What this endpoint is for is the three things a frontend cannot do:
 *
 *   1. The API key lives in this Function's environment, not in a bundle. It is
 *      never sent to the client and never appears in a response body.
 *   2. The system prompt lives in `system-prompt.ts`, compiled into the deployed
 *      code. No request field can replace it.
 *   3. Every request is bounded before it costs anything: who may call, how much
 *      history they may send, and how long the answer may be.
 *
 * The client's half of the contract is deliberately tiny: POST `{ messages }`,
 * receive the answer as server-sent events. Model, temperature and output
 * ceiling are not fields.
 */

/** Any OpenAI-compatible endpoint. Point it elsewhere with `OPENAI_BASE_URL`. */
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

/** Bound on how much of a provider error is written to the logs. */
const MAX_LOGGED_ERROR_CHARS = 500;

/** Said in a refusal before the stream begins, and on the stream after it. */
const UNUSABLE = "The model provider returned an unusable response.";

/**
 * Answer with no CORS headers at all — the only honest response to an origin
 * that was refused. Handing it `Access-Control-Allow-Origin` would be granting
 * the access the refusal just denied.
 */
const WITHOUT_CORS = null;

export default {
  async fetch(request: Request): Promise<Response> {
    const allowed = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
    const origin = checkOrigin(request.headers.get("origin"), allowed);

    // Decided before the method, so a preflight from an origin you did not
    // authorise is refused at the same gate a real request would be.
    if (!origin.ok) {
      return refuse(origin.refusal, WITHOUT_CORS);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin.allowOrigin) });
    }

    if (request.method !== "POST") {
      return refuse({ status: 405, error: "This endpoint accepts POST." }, origin.allowOrigin);
    }

    if (allowed.length === 0) {
      console.warn(
        "ALLOWED_ORIGINS is not set, so any website can spend this endpoint's budget — " +
          "set it with: wawesome env set ALLOWED_ORIGINS https://your-site.com",
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      // The one failure the client is told nothing about beyond "not
      // configured": which credential is missing is the operator's business.
      console.error("OPENAI_API_KEY is not set — run: wawesome env set OPENAI_API_KEY sk-... --secret");
      return refuse({ status: 500, error: "This endpoint is not configured." }, origin.allowOrigin);
    }

    const parsed = parseChatRequest(await request.text());
    if (!parsed.ok) {
      return refuse(parsed.refusal, origin.allowOrigin);
    }

    const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
    const baseUrl = (process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");

    const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model,
      // The server's prompt first, the client's conversation after it. The
      // client cannot get a message in front of this one — `parseChatRequest`
      // refuses a `system` role rather than sanitising it.
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...parsed.messages],
      // The current name for the output ceiling. OpenAI deprecated `max_tokens`
      // and rejects it outright on reasoning models — and a ceiling the provider
      // ignores is not a cost control. Some OpenAI-compatible hosts only know the
      // old name; if yours ignores this, that is the one word to change.
      max_completion_tokens: LIMITS.maxOutputTokens,
      temperature: 0.3,
      stream: true,
      // Without this the token counts simply never arrive: a streamed completion
      // reports usage in one final event, and only to a request that asked for
      // it. Opting out here would turn this endpoint's cost line into zeroes.
      stream_options: { include_usage: true },
    };

    const startedAt = Date.now();
    let upstream: Response;
    try {
      upstream = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      // Distinct from a rejection on purpose. If you have just deployed and see
      // this, the likely cause is that the host is not on this App's outbound
      // allowlist — `init --template` enables the `openai` provider, but a
      // different OPENAI_BASE_URL needs its host added.
      console.error(`Could not reach ${baseUrl}: ${messageOf(cause)}`);
      return refuse({ status: 502, error: "The model provider could not be reached." }, origin.allowOrigin);
    }

    if (!upstream.ok) {
      const detail = (await upstream.text().catch(() => "")).slice(0, MAX_LOGGED_ERROR_CHARS);
      console.error(`Provider returned ${upstream.status}: ${detail}`);

      // Passed through rather than flattened: a frontend can back off on a 429,
      // and cannot on a 502. Everything else collapses, because the provider's
      // own error text is not something to hand to a stranger's browser.
      return upstream.status === 429
        ? refuse({ status: 429, error: "Too many requests right now. Try again shortly." }, origin.allowOrigin)
        : refuse({ status: 502, error: "The model provider rejected the request." }, origin.allowOrigin);
    }

    if (!upstream.body) {
      console.error("Provider answered 200 with no body.");
      return refuse({ status: 502, error: UNUSABLE }, origin.allowOrigin);
    }

    // The last point at which this endpoint can still choose a status. Everything
    // after it is in-band, on a response the caller already holds — which is why
    // the boundary is here rather than at the first token: waiting for the model
    // to start would spend the invocation's time-to-commit on its latency, and a
    // refusal shape is not worth being trapped for.
    return new Response(eventStream(answerEvents(upstream.body, model, startedAt)), {
      status: 200,
      headers: {
        ...corsHeaders(origin.allowOrigin),
        "Content-Type": "text/event-stream",
        // An answer generated once, for one caller, that no intermediary should
        // ever hold on to or replay.
        "Cache-Control": "no-store",
      },
    });
  },
};

/**
 * The stream is read once and serves two purposes: the text goes to the browser
 * as it arrives, and the token counts riding on the provider's final event go to
 * the log line. Recovering the usage from a second pass would mean parsing the
 * same events twice; losing it would mean the cost line quietly reporting zero
 * for every streamed answer, which is the thing this template exists to show.
 */
async function* answerEvents(
  body: ReadableStream<Uint8Array>,
  model: string,
  startedAt: number,
): AsyncGenerator<string> {
  let usage: TokenUsage | null = null;
  let finishReason: string | null = null;
  let delivered = false;

  try {
    for await (const data of readDataEvents(body)) {
      const chunk = parseChunk(data);
      if (!chunk) continue;

      // Once the opt-in is on every event carries the field, holding null until
      // the last one — so this keeps the newest usable value rather than the
      // newest value, and tolerates a provider that reports it somewhere else.
      usage = readUsage(chunk) ?? usage;

      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;

      const text = choice?.delta?.content;
      if (typeof text === "string" && text.length > 0) {
        delivered = true;
        yield formatEvent("delta", { text });
      }
    }

    if (!delivered) {
      console.error("Provider answered 200 with no message content.");
      yield formatEvent("error", { error: UNUSABLE });
      return;
    }

    if (!finishReason) {
      // Neither event is the contract's third case, and the only honest one: a
      // body that stopped without saying why may have been cut off, and `stop`
      // would tell the page a half answer is whole.
      console.error(`The provider's stream ended with no finish_reason after ${Date.now() - startedAt}ms.`);
      return;
    }

    yield formatEvent("done", { finish_reason: finishReason });
  } catch (cause) {
    // The status went out with the first byte, so this is the only way left to
    // tell the caller. A page that has seen neither this nor `done` has an
    // answer that stopped for a reason nothing in the stream could report —
    // a dropped connection, or the platform ending the invocation.
    console.error(`The provider's stream failed after ${Date.now() - startedAt}ms: ${messageOf(cause)}`);
    yield formatEvent("error", { error: "The answer was interrupted." });
  } finally {
    // In `finally` so the bill is recorded for an answer that broke or was
    // abandoned exactly as it is for one that finished.
    console.log(
      usageLine({
        model,
        usage,
        elapsedMs: Date.now() - startedAt,
        pricing: readPricing(process.env),
      }),
    );
  }
}

function parseChunk(data: string): OpenAI.Chat.Completions.ChatCompletionChunk | null {
  try {
    return JSON.parse(data) as OpenAI.Chat.Completions.ChatCompletionChunk;
  } catch {
    return null;
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * CORS headers for an answer.
 *
 * On every response an admitted origin gets, including the refusals: without
 * them a browser cannot read the status or the body, and a 413 the frontend
 * cannot see is indistinguishable from the endpoint being down. A *refused*
 * origin is the one exception — see [`WITHOUT_CORS`].
 */
function corsHeaders(allowOrigin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    // The answer depends on the request's Origin, so a cache must not serve one
    // origin's response to another.
    Vary: "Origin",
  };
}

function json(payload: unknown, status: number, allowOrigin: string | null): Response {
  return Response.json(payload, {
    status,
    headers: allowOrigin ? corsHeaders(allowOrigin) : {},
  });
}

/**
 * A refusal, in JSON rather than on the stream.
 *
 * Everything decided before the answer begins is answered this way — the origin,
 * the body, the ceilings, and a provider that refuses or cannot be reached. A
 * client checks `response.ok` before it starts reading events, and gets one
 * `error` string either way.
 */
function refuse(refusal: Refusal, allowOrigin: string | null): Response {
  return json({ error: refusal.error }, refusal.status, allowOrigin);
}

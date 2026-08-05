import type OpenAI from "openai";
import { LIMITS, checkOrigin, parseAllowedOrigins, parseChatRequest, type Refusal } from "./policy.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { readPricing, readUsage, usageLine } from "./usage.js";

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
 * receive `{ reply }`. Model, temperature and output ceiling are not fields.
 */

/** Any OpenAI-compatible endpoint. Point it elsewhere with `OPENAI_BASE_URL`. */
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

/** Bound on how much of a provider error is written to the logs. */
const MAX_LOGGED_ERROR_CHARS = 500;

export default {
  async fetch(request: Request): Promise<Response> {
    const allowed = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
    const origin = checkOrigin(request.headers.get("origin"), allowed);

    // Decided before the method, so a preflight from an origin you did not
    // authorise is refused at the same gate a real request would be.
    if (!origin.ok) {
      return refuse(origin.refusal, null);
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

    const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
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
      console.error(`Could not reach ${baseUrl}: ${cause instanceof Error ? cause.message : String(cause)}`);
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

    const completion = (await upstream.json().catch(() => null)) as OpenAI.Chat.Completions.ChatCompletion | null;
    const reply = completion?.choices?.[0]?.message?.content;

    // One line per request, on stdout, which is what `wawesome logs --follow`
    // streams. This is where the bill the frontend can no longer see goes.
    console.log(
      usageLine({
        model,
        usage: readUsage(completion),
        elapsedMs: Date.now() - startedAt,
        pricing: readPricing(process.env),
      }),
    );

    if (typeof reply !== "string") {
      console.error("Provider answered 200 with no message content.");
      return refuse({ status: 502, error: "The model provider returned an unusable response." }, origin.allowOrigin);
    }

    return json({ reply }, 200, origin.allowOrigin);
  },
};

/**
 * CORS headers for an answer.
 *
 * On every response including the refusals: without them a browser cannot read
 * the status or the body, and a 413 the frontend cannot see is indistinguishable
 * from the endpoint being down.
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

/** A refusal, answered in the same shape as a success so a client parses one path. */
function refuse(refusal: Refusal, allowOrigin: string | null): Response {
  return json({ error: refusal.error }, refusal.status, allowOrigin);
}

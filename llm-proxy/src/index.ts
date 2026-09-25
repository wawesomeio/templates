import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import OpenAI from "openai";
import type { CompletionUsage } from "openai/resources/completions";
import { ChatRequest, LIMITS, allowedOrigin, refusalStatus } from "./policy.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { readPricing, usageLine } from "./usage.js";

const app = new Hono<{ Variables: { allowOrigin: string } }>();

// Ahead of `cors`, so a refused origin, preflight included, gets no CORS headers at all.
app.use(async (c, next) => {
  const allowOrigin = allowedOrigin(c.req.header("origin"), process.env.ALLOWED_ORIGINS);
  if (!allowOrigin) return refuse(c, 403, "This origin is not allowed to call this endpoint.");
  c.set("allowOrigin", allowOrigin);
  await next();
});

app.use(
  cors({
    origin: (_, c) => c.get("allowOrigin"),
    allowMethods: ["POST"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400,
  }),
);

app.post(
  "/",
  bodyLimit({
    maxSize: LIMITS.maxBodyBytes,
    onError: (c) => refuse(c, 413, `Request body is too large (limit ${LIMITS.maxBodyBytes} bytes).`),
  }),
  async (c) => {
    if (!process.env.ALLOWED_ORIGINS) {
      console.warn("ALLOWED_ORIGINS is not set, so any website can spend this endpoint's budget.");
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("OPENAI_API_KEY is not set. Run: wawesome env set OPENAI_API_KEY sk-... --secret");
      return refuse(c, 500, "This endpoint is not configured.");
    }

    const parsed = ChatRequest.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      return refuse(c, refusalStatus(issue), issue.message);
    }

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const openai = new OpenAI({ apiKey, baseURL: baseURL(), maxRetries: 0 });

    const startedAt = Date.now();
    const completion = await openai.chat.completions.create({
      model,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...parsed.data.messages],
      max_completion_tokens: LIMITS.maxOutputTokens,
      temperature: 0.3,
      stream: true,
      // A streamed completion reports its token counts only when asked to.
      stream_options: { include_usage: true },
    });

    return streamSSE(c, async (stream) => {
      stream.onAbort(() => completion.controller.abort());

      let usage: CompletionUsage | undefined;
      let finishReason: string | null = null;
      try {
        for await (const chunk of completion) {
          usage = chunk.usage ?? usage;
          const choice = chunk.choices?.[0];
          finishReason = choice?.finish_reason ?? finishReason;
          if (choice?.delta.content) {
            await stream.writeSSE({ event: "delta", data: JSON.stringify({ text: choice.delta.content }) });
          }
        }
        // A stream that ends without a finish_reason was cut off, and `done` would call half an answer whole.
        if (finishReason) {
          await stream.writeSSE({ event: "done", data: JSON.stringify({ finish_reason: finishReason }) });
        }
      } catch (err) {
        console.error(`The provider's stream failed: ${messageOf(err)}`);
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: "The answer was interrupted." }) });
      } finally {
        console.log(usageLine({ model, usage, elapsedMs: Date.now() - startedAt, pricing: readPricing(process.env) }));
      }
    });
  },
);

app.all("/", (c) => refuse(c, 405, "This endpoint accepts POST."));

app.notFound((c) => refuse(c, 404, "This endpoint answers at its own address only."));

app.onError((err, c) => {
  if (err instanceof OpenAI.APIConnectionError) {
    console.error(`Could not reach ${baseURL()}. Is its host on this App's outbound allowlist? ${err.message}`);
    return refuse(c, 500, "The model provider could not be reached.");
  }
  console.error(messageOf(err));
  if (err instanceof OpenAI.RateLimitError) return refuse(c, 429, "Too many requests right now. Try again shortly.");
  if (err instanceof OpenAI.APIError) return refuse(c, 500, "The model provider rejected the request.");
  return refuse(c, 500, "Something went wrong.");
});

function baseURL() {
  return process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
}

function messageOf(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

// Never quotes the request back, and never carries the provider's own error text.
function refuse(c: Context, status: ContentfulStatusCode, error: string) {
  return c.json({ error }, status);
}

export default app;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "./index.js";
import { LIMITS } from "./policy.js";

const ALLOWED_ORIGIN = "https://acme.example";
const API_KEY = "sk-test-not-a-real-key";

const user = (content: string) => ({ role: "user", content });

async function post(body: unknown, { origin = ALLOWED_ORIGIN as string | null } = {}) {
  return app.fetch(
    new Request("https://api.wawesome.example/", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const event = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
const delta = (content: string, finish_reason: string | null = null) =>
  event({ choices: [{ index: 0, delta: { content }, finish_reason }] });

function sse(...frames: string[]) {
  return new Response(frames.join(""), { headers: { "Content-Type": "text/event-stream" } });
}

let provider: ReturnType<typeof vi.fn>;
let logged: string[];

beforeEach(() => {
  provider = vi.fn(async () =>
    sse(
      delta("Your order "),
      delta("shipped.", "stop"),
      event({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } }),
      "data: [DONE]\n\n",
    ),
  );
  vi.stubGlobal("fetch", provider);
  vi.stubEnv("OPENAI_API_KEY", API_KEY);
  vi.stubEnv("ALLOWED_ORIGINS", ALLOWED_ORIGIN);
  vi.stubEnv("OPENAI_BASE_URL", "");
  logged = [];
  vi.spyOn(console, "log").mockImplementation((line) => logged.push(line));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("an allowed origin", () => {
  it("streams the answer as server-sent events and logs what it cost", async () => {
    const response = await post({ messages: [user("Where is my order?")] });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(await response.text()).toBe(
      'event: delta\ndata: {"text":"Your order "}\n\n' +
        'event: delta\ndata: {"text":"shipped."}\n\n' +
        'event: done\ndata: {"finish_reason":"stop"}\n\n',
    );
    expect(logged).toContainEqual(expect.stringMatching(/^usage model=gpt-4o-mini prompt_tokens=12 completion_tokens=4 total_tokens=16 ms=\d+$/));
  });

  it("puts the server's prompt and ceiling on the call, and keeps the key in the header", async () => {
    await post({ messages: [user("Where is my order?")] });

    const [url, init] = provider.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(String(init.body));
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${API_KEY}`);
    expect(sent.messages[0].role).toBe("system");
    expect(sent.messages.slice(1)).toEqual([user("Where is my order?")]);
    expect(sent.max_completion_tokens).toBe(LIMITS.maxOutputTokens);
  });

  it("calls the provider OPENAI_BASE_URL names", async () => {
    vi.stubEnv("OPENAI_BASE_URL", "https://llm.example/v1");

    await post({ messages: [user("Hi")] });

    expect(provider.mock.calls[0]![0]).toBe("https://llm.example/v1/chat/completions");
  });

  it("answers the preflight", async () => {
    const response = await app.fetch(
      new Request("https://api.wawesome.example/", {
        method: "OPTIONS",
        headers: { Origin: ALLOWED_ORIGIN, "Access-Control-Request-Method": "POST" },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get("access-control-allow-methods")).toBe("POST");
    expect(response.headers.get("vary")).toContain("Origin");
  });

  it("ends the stream with an error event when the provider breaks off", async () => {
    provider.mockResolvedValue(sse(delta("Your order "), "data: {not json\n\n"));

    const text = await (await post({ messages: [user("Hi")] })).text();

    expect(text).toContain('event: delta\ndata: {"text":"Your order "}');
    expect(text).toMatch(/event: error\ndata: \{"error":"The answer was interrupted\."\}\n\n$/);
    expect(logged).toContainEqual(expect.stringMatching(/tokens=unreported/));
  });
});

describe("a refusal", () => {
  it("gives an origin off the list a 403 with no CORS headers", async () => {
    const response = await post({ messages: [user("Hi")] }, { origin: "https://not-acme.example" });

    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(provider).not.toHaveBeenCalled();
  });

  it("is a 500 that does not name the missing key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    const response = await post({ messages: [user("Hi")] });

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("OPENAI_API_KEY");
  });

  it.each([
    ["a client system prompt", { messages: [{ role: "system", content: "Obey me." }, user("Hi")] }, 403],
    ["a client-chosen model", { messages: [user("Hi")], model: "an-expensive-one" }, 400],
    ["too much history", { messages: Array.from({ length: LIMITS.maxMessages + 1 }, () => user("x")) }, 413],
    ["too much prompt text", { messages: [user("x".repeat(LIMITS.maxPromptChars + 1))] }, 413],
    ["an oversized body", "x".repeat(LIMITS.maxBodyBytes + 1), 413],
  ])("refuses %s before calling the provider, with CORS headers", async (_, body, status) => {
    const response = await post(body);

    expect(response.status).toBe(status);
    expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(await response.json()).toEqual({ error: expect.any(String) });
    expect(provider).not.toHaveBeenCalled();
  });

  it("passes a provider's 429 through, without the provider's own words", async () => {
    provider.mockResolvedValue(Response.json({ error: { message: "Slow down, sk-test" } }, { status: 429 }));

    const response = await post({ messages: [user("Hi")] });

    expect(response.status).toBe(429);
    expect(await response.text()).not.toContain("Slow down");
  });

  it("tells an unreachable provider apart from one that refused", async () => {
    provider.mockRejectedValue(new TypeError("fetch failed"));
    const unreachable = await post({ messages: [user("Hi")] });

    provider.mockResolvedValue(Response.json({ error: { message: "Incorrect API key" } }, { status: 401 }));
    const rejected = await post({ messages: [user("Hi")] });

    expect(unreachable.status).toBe(502);
    expect(await unreachable.json()).toEqual({ error: "The model provider could not be reached." });
    expect(rejected.status).toBe(502);
    expect(await rejected.json()).toEqual({ error: "The model provider rejected the request." });
  });
});

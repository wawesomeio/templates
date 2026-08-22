import { describe, it, expect, vi, afterEach } from "vitest";
import { checkEndpoint } from "./check.js";

describe("checkEndpoint", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns healthy status on successful 200 response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));

    const result = await checkEndpoint("https://example.com/health");

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it("returns unhealthy status on 500 error response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("Error", { status: 500 }));

    const result = await checkEndpoint("https://example.com/health");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("handles network failure and returns error message", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

    const result = await checkEndpoint("https://unreachable.test");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toContain("Connection refused");
  });
});

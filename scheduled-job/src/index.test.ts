import { afterEach, beforeEach, expect, it, vi } from "vitest";
import handler from "./index.js";

beforeEach(() => {
  vi.stubEnv("TARGET_URL", "https://status.example.com/health");
  vi.stubEnv("JOB_SECRET", "");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("OK")));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function run(headers: Record<string, string>) {
  return handler.fetch(new Request("https://scheduled-job.example/", { headers }));
}

it("checks TARGET_URL on a scheduled run", async () => {
  const response = await run({ "x-wawesome-trigger": "schedule" });

  expect(response.status).toBe(204);
  expect(fetch).toHaveBeenCalledWith("https://status.example.com/health", expect.anything());
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Health check succeeded"));
});

it("refuses a caller without the JOB_SECRET bearer token", async () => {
  vi.stubEnv("JOB_SECRET", "supersecret");

  const response = await run({ authorization: "Bearer wrong" });

  expect(response.status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});

it("fails the run when TARGET_URL is not set", async () => {
  vi.stubEnv("TARGET_URL", "");

  const response = await run({ "x-wawesome-trigger": "schedule" });

  expect(response.status).toBe(500);
  expect(fetch).not.toHaveBeenCalled();
});

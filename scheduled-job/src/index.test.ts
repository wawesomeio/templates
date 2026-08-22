import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler, { isAuthorizedTrigger } from "./index.js";

describe("scheduled-job handler", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  });

  describe("isAuthorizedTrigger", () => {
    it("allows trigger: schedule without secret", () => {
      const req = new Request("http://localhost/", {
        headers: { "x-wawesome-trigger": "schedule" },
      });
      expect(isAuthorizedTrigger(req)).toBe(true);
    });

    it("allows trigger: manual without secret", () => {
      const req = new Request("http://localhost/", {
        headers: { "x-wawesome-trigger": "manual" },
      });
      expect(isAuthorizedTrigger(req)).toBe(true);
    });

    it("allows caller when no JOB_SECRET is configured", () => {
      delete process.env.JOB_SECRET;
      const req = new Request("http://localhost/", {
        headers: { "x-wawesome-trigger": "caller" },
      });
      expect(isAuthorizedTrigger(req)).toBe(true);
    });

    it("allows caller with valid Bearer token when JOB_SECRET is set", () => {
      process.env.JOB_SECRET = "supersecret";
      const req = new Request("http://localhost/", {
        headers: {
          "x-wawesome-trigger": "caller",
          authorization: "Bearer supersecret",
        },
      });
      expect(isAuthorizedTrigger(req)).toBe(true);
    });

    it("rejects caller with invalid Bearer token when JOB_SECRET is set", () => {
      process.env.JOB_SECRET = "supersecret";
      const req = new Request("http://localhost/", {
        headers: {
          "x-wawesome-trigger": "caller",
          authorization: "Bearer wrongsecret",
        },
      });
      expect(isAuthorizedTrigger(req)).toBe(false);
    });

    it("rejects caller with missing Authorization header when JOB_SECRET is set", () => {
      process.env.JOB_SECRET = "supersecret";
      const req = new Request("http://localhost/", {
        headers: { "x-wawesome-trigger": "caller" },
      });
      expect(isAuthorizedTrigger(req)).toBe(false);
    });
  });

  describe("fetch", () => {
    it("executes scheduled run and returns 204", async () => {
      const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

      const req = new Request("http://localhost/", {
        headers: { "x-wawesome-trigger": "schedule" },
      });
      const res = await handler.fetch(req);

      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
      expect(consoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Starting scheduled run (trigger=schedule)"),
      );
      expect(consoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Health check succeeded"),
      );

      consoleLog.mockRestore();
    });

    it("executes manual trigger run and returns 204", async () => {
      const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

      const req = new Request("http://localhost/", {
        headers: { "x-wawesome-trigger": "manual" },
      });
      const res = await handler.fetch(req);

      expect(res.status).toBe(204);
      expect(consoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Starting scheduled run (trigger=manual)"),
      );

      consoleLog.mockRestore();
    });

    it("returns 401 when unauthorized caller invokes the function", async () => {
      process.env.JOB_SECRET = "supersecret";
      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const req = new Request("http://localhost/", {
        headers: { "x-wawesome-trigger": "caller" },
      });
      const res = await handler.fetch(req);

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data).toEqual({ error: "Unauthorized" });
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining("Unauthorized invocation attempt"),
      );

      consoleWarn.mockRestore();
    });

    it("logs failure message when health check fails", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response("Error", { status: 503 }));
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      const req = new Request("http://localhost/", {
        headers: { "x-wawesome-trigger": "schedule" },
      });
      const res = await handler.fetch(req);

      expect(res.status).toBe(204);
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("Health check failed"),
      );

      consoleError.mockRestore();
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "./index.js";

const AMELIA = {
  id: "7f3c2a1e-4b5d-4c6e-8f90-1a2b3c4d5e6f",
  name: "Amelia Okonkwo",
  email: "amelia@example.com",
  created_at: "2026-09-01T09:14:00Z",
};
const MISSING = "00000000-0000-4000-8000-000000000000";

let supabase: ReturnType<typeof vi.fn>;

function answer(status: number, body?: unknown) {
  supabase.mockResolvedValueOnce(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function call(method: string, path: string, body?: unknown) {
  return app.fetch(
    new Request(`https://api.wawesome.io${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-wawesome-forwarded-prefix": "/x/acme/rest-api/customers",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

function sentToSupabase() {
  const [url, init] = supabase.mock.calls[0] as [string, RequestInit];
  return { url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined };
}

beforeEach(() => {
  supabase = vi.fn();
  vi.stubGlobal("fetch", supabase);
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_KEY", "sb_secret_test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /", () => {
  it("lists the customers", async () => {
    answer(200, [AMELIA]);

    const response = await call("GET", "/");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([AMELIA]);
    expect(sentToSupabase().url).toMatch(/^https:\/\/project\.supabase\.co\/rest\/v1\/customers\?/);
  });

  it("is a 503 until Supabase is set", async () => {
    vi.stubEnv("SUPABASE_KEY", "");

    const response = await call("GET", "/");

    expect(response.status).toBe(503);
    expect(supabase).not.toHaveBeenCalled();
  });

  it("is a 503 naming the secret key when SUPABASE_KEY is the publishable one", async () => {
    vi.stubEnv("SUPABASE_KEY", "sb_publishable_test");

    const response = await call("GET", "/");

    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("sb_secret_");
    expect(supabase).not.toHaveBeenCalled();
  });
});

describe("POST /", () => {
  it("creates a customer and answers where to find it", async () => {
    answer(201, [AMELIA]);

    const response = await call("POST", "/", { name: AMELIA.name, email: AMELIA.email });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(AMELIA);
    expect(response.headers.get("Location")).toBe(
      `https://api.wawesome.io/x/acme/rest-api/customers/${AMELIA.id}`,
    );
    expect(sentToSupabase()).toMatchObject({ method: "POST", body: { name: AMELIA.name, email: AMELIA.email } });
  });

  it("is a 422 naming the field that is wrong", async () => {
    const response = await call("POST", "/", { name: "Nadia", email: "not-an-address" });

    expect(response.status).toBe(422);
    expect(Object.keys((await response.json()).errors)).toEqual(["email"]);
    expect(supabase).not.toHaveBeenCalled();
  });
});

describe("GET /:id", () => {
  it("reads one customer", async () => {
    answer(200, [AMELIA]);

    const response = await call("GET", `/${AMELIA.id}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(AMELIA);
  });

  it("is a 404 when there is no such customer", async () => {
    answer(200, []);

    expect((await call("GET", `/${MISSING}`)).status).toBe(404);
  });

  it("is a 404 for an id that is not a uuid, without asking Supabase", async () => {
    expect((await call("GET", "/cus_amelia")).status).toBe(404);
    expect(supabase).not.toHaveBeenCalled();
  });
});

describe("PUT /:id", () => {
  it("replaces a customer", async () => {
    const replaced = { ...AMELIA, name: "Amelia Okafor" };
    answer(200, [replaced]);

    const response = await call("PUT", `/${AMELIA.id}`, { name: replaced.name, email: replaced.email });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(replaced);
    expect(sentToSupabase()).toMatchObject({ method: "PATCH", body: { name: replaced.name } });
  });

  it("is a 404 when there is no such customer", async () => {
    answer(200, []);

    expect((await call("PUT", `/${MISSING}`, { name: "Nadia", email: "nadia@example.com" })).status).toBe(404);
  });
});

describe("DELETE /:id", () => {
  it("deletes a customer", async () => {
    answer(200, [AMELIA]);

    const response = await call("DELETE", `/${AMELIA.id}`);

    expect(response.status).toBe(204);
    expect(sentToSupabase().method).toBe("DELETE");
  });

  it("is a 404 when there is no such customer", async () => {
    answer(200, []);

    expect((await call("DELETE", `/${MISSING}`)).status).toBe(404);
  });
});

describe("GET /:id/orders", () => {
  it("lists the customer's orders", async () => {
    const order = { id: 1, customer_id: AMELIA.id, total_cents: 4250, currency: "EUR", placed_at: "2026-09-02T10:00:00Z" };
    answer(200, [{ orders: [order] }]);

    const response = await call("GET", `/${AMELIA.id}/orders`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([order]);
  });

  it("is a 404 when there is no such customer", async () => {
    answer(200, []);

    expect((await call("GET", `/${MISSING}/orders`)).status).toBe(404);
  });
});

describe("when Supabase refuses", () => {
  it("is a 500, and the reason goes to the logs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    answer(401, { message: "Invalid API key" });

    const response = await call("GET", "/");

    expect(response.status).toBe(500);
    expect(log.mock.calls.join(" ")).toContain("Invalid API key");
  });
});

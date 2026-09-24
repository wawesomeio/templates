import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "./index.js";

const DATABASE_URL = "https://abcdefghijklmnop.supabase.co";
const KEY = "sb_publishable_not-a-real-key";

const valid = { name: "Priya Shah", email: "priya@example.com", message: "A small courtyard, mostly shade." };

let supabase: ReturnType<typeof vi.fn>;

function postForm(fields: Record<string, string>) {
  return app.fetch(
    new Request("https://fernhill.example/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    }),
  );
}

function postJson(body: unknown) {
  return app.fetch(
    new Request("https://fernhill.example/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  supabase = vi.fn(async () => new Response(null, { status: 201 }));
  vi.stubGlobal("fetch", supabase);
  vi.stubEnv("SUPABASE_URL", DATABASE_URL);
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", KEY);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a form post", () => {
  it("saves the enquiry and sends the visitor to the thank-you state", async () => {
    const response = await postForm(valid);

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("#sent");

    const [url, init] = supabase.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${DATABASE_URL}/rest/v1/enquiries`);
    expect(init.headers).toMatchObject({ apikey: KEY, Prefer: "return=minimal" });
    expect(JSON.parse(String(init.body))).toEqual(valid);
  });

  it("is a 422 naming each field that is wrong", async () => {
    const response = await postForm({ name: valid.name, email: "priya" });
    const text = await response.text();

    expect(response.status).toBe(422);
    expect(text).toContain("email:");
    expect(text).toContain("message:");
    expect(text).not.toContain("name:");
    expect(supabase).not.toHaveBeenCalled();
  });
});

describe("a JSON post", () => {
  it("saves the enquiry and answers 201", async () => {
    const response = await postJson(valid);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ status: "sent" });
  });

  it("is a 422 naming each field that is wrong", async () => {
    const response = await postJson({ name: " ", email: valid.email, message: valid.message });

    expect(response.status).toBe(422);
    expect(Object.keys((await response.json()).errors)).toEqual(["name"]);
  });
});

describe("before Supabase is set", () => {
  it("is a 503 naming the next step, and saves nothing", async () => {
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");

    const response = await postJson(valid);

    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("schema.sql");
    expect(supabase).not.toHaveBeenCalled();
  });
});

describe("when Supabase refuses", () => {
  it("is a 502, and the reason goes to the logs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    supabase.mockResolvedValue(new Response('{"code":"PGRST205"}', { status: 404 }));

    const response = await postForm(valid);

    expect(response.status).toBe(502);
    expect(log.mock.calls.join(" ")).toContain("PGRST205");
  });
});

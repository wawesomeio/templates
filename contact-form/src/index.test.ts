import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "./index.js";

const ADDRESS = "https://fernhill.example";
const DATABASE_URL = "https://abcdefghijklmnop.supabase.co";
const KEY = "sb_publishable_not-a-real-key";

const valid = { name: "Priya Shah", email: "priya@example.com", message: "A small courtyard, mostly shade." };

function call(path: string, init?: RequestInit): Promise<Response> {
  return handler.fetch(new Request(ADDRESS + path, init));
}

function postForm(fields: Record<string, string>): Promise<Response> {
  return call("/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

function postJson(body: unknown): Promise<Response> {
  return call("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

let database: ReturnType<typeof vi.fn>;

beforeEach(() => {
  database = vi.fn(async () => new Response(null, { status: 201 }));
  vi.stubGlobal("fetch", database);
  vi.stubEnv("SUPABASE_URL", DATABASE_URL);
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", KEY);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the page", () => {
  it("is served at the Function's address, with a labelled field for each input", async () => {
    const response = await call("/");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    for (const field of ["name", "email", "message"]) {
      expect(html).toContain(`<label for="${field}">`);
      expect(html).toContain(`id="${field}" name="${field}"`);
    }
  });

  it("posts to its own address as a plain form, so it works with JavaScript turned off", async () => {
    const html = await (await call("/")).text();

    expect(html).toContain('<form method="post" action=""');
    expect(html).not.toContain("<script");
  });

  it("is served with no database configured", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");

    expect((await call("/")).status).toBe(200);
  });

  it("thanks the visitor after a message is sent", async () => {
    expect(await (await call("/?sent")).text()).toContain('role="status" tabindex="-1" autofocus>Thank you.');
  });

  it("never carries the key", async () => {
    const pages = await Promise.all([
      call("/"),
      call("/?sent"),
      postForm({ ...valid, email: "priya" }),
    ]);

    for (const response of pages) expect(await response.text()).not.toContain(KEY);
  });

  it("answers anywhere else with 404", async () => {
    expect((await call("/admin")).status).toBe(404);
  });

  it("says what it answers when asked for something else", async () => {
    const response = await call("/", { method: "DELETE" });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD, POST");
  });
});

describe("a form submission", () => {
  it("is written to the table with the publishable key, and redirects to the thank-you page", async () => {
    const response = await postForm(valid);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("?sent");

    const [url, init] = database.mock.calls[0];
    expect(url).toBe(`${DATABASE_URL}/rest/v1/enquiries`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ apikey: KEY, Prefer: "return=minimal" });
    expect(JSON.parse(init.body)).toEqual(valid);
  });

  it("that fails validation is 422, with the error against the field and what was typed kept", async () => {
    const response = await postForm({ ...valid, email: "priya" });
    const html = await response.text();

    expect(response.status).toBe(422);
    expect(html).toContain("<title>Error: ");
    expect(html).toContain('<li><a href="#email">');
    expect(html).toContain('<p class="error" id="email-error">');
    expect(html).toMatch(/id="email"[^>]*aria-invalid="true" aria-describedby="email-error"/);
    expect(html).toContain('value="priya"');
    expect(html).toContain(`value="${valid.name}"`);
    expect(database).not.toHaveBeenCalled();
  });

  it("escapes what was typed when showing it back", async () => {
    const html = await (await postForm({ ...valid, email: '"><script>alert(1)</script>' })).text();

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("with no database configured is 503, naming the next step", async () => {
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");

    const response = await postForm(valid);
    const html = await response.text();

    expect(response.status).toBe(503);
    expect(html).toContain("schema.sql");
    expect(html).toContain("SUPABASE_URL");
    expect(database).not.toHaveBeenCalled();
  });

  it("that the database refuses is 502, and the reason goes to the logs", async () => {
    database.mockResolvedValue(new Response('{"code":"PGRST205"}', { status: 404 }));

    const response = await postForm(valid);

    expect(response.status).toBe(502);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("PGRST205"));
  });

  it("that cannot reach the database is 502", async () => {
    database.mockRejectedValue(new TypeError("host not allowed"));

    expect((await postForm(valid)).status).toBe(502);
  });

  it("sent as something other than a form or JSON is 415", async () => {
    const response = await call("/", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "hi" });

    expect(response.status).toBe(415);
  });
});

describe("a JSON submission", () => {
  it("is 201 when written", async () => {
    const response = await postJson(valid);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ status: "sent" });
  });

  it("is 422 naming each field that failed", async () => {
    const response = await postJson({ name: "Priya Shah" });

    expect(response.status).toBe(422);
    expect(Object.keys((await response.json()).errors)).toEqual(["email", "message"]);
  });

  it.each([["{ not json"], ["[]"], ["null"]])("refuses %o with 400", async (body) => {
    expect((await postJson(body)).status).toBe(400);
  });

  it("with no database configured is 503 with the same next step", async () => {
    vi.stubEnv("SUPABASE_URL", "");

    const response = await postJson(valid);

    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("schema.sql");
  });
});

import { describe, it, expect } from "vitest";
import handler from "./index.js";
import { prices } from "./pricing.js";

const ADDRESS = "https://copperline.example";

/**
 * @param {string} path
 * @param {RequestInit} [init]
 */
function call(path, init) {
  return handler.fetch(new Request(`${ADDRESS}${path}`, init));
}

/**
 * @param {string} path
 * @param {unknown} body
 */
function post(path, body) {
  return call(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("the pages", () => {
  it.each(["/", "", "/index.html"])("answers %o with the page the deploy carried", async (path) => {
    const response = await call(path);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-wawesome-document")).toBe("index.html");
  });

  it("answers an address no page claims with the not-found page, at 404", async () => {
    const response = await call("/prices/2019");

    expect(response.status).toBe(404);
    expect(response.headers.get("x-wawesome-document")).toBe("404.html");
  });

  it("names a file rather than rendering one, so nothing here writes markup", async () => {
    const response = await call("/");

    expect(await response.text()).toBe("");
  });
});

describe("the endpoint the form posts to", () => {
  it("prices an order posted to the page's own address", async () => {
    const response = await post("/", { quantity: 250, colours: 2, rush: false });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const priced = await response.json();
    expect(priced.currency).toBe(prices.currency);
    expect(priced.total_pence).toBeGreaterThan(0);
    expect(priced.lines).toHaveLength(2);
  });

  it("answers at the same address the page was served from, so the form needs no base URL", async () => {
    const fromRoot = await post("/", { quantity: 100, colours: 1, rush: false });
    const fromPage = await post("/index.html", { quantity: 100, colours: 1, rush: false });

    expect(await fromRoot.json()).toEqual(await fromPage.json());
  });

  it("has nothing to post to where there is no page", async () => {
    const response = await post("/nowhere", { quantity: 100, colours: 1, rush: false });

    expect(response.status).toBe(404);
    expect(response.headers.get("x-wawesome-document")).toBe(null);
  });

  it("refuses an order it cannot price, naming the field", async () => {
    const response = await post("/", { quantity: 3, colours: 1, rush: false });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ field: "quantity" });
  });

  it("refuses a body that is not JSON", async () => {
    const response = await post("/", "{ not json");

    expect(response.status).toBe(400);
  });

  it("refuses a body sent as something other than JSON", async () => {
    const response = await call("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "quantity=250",
    });

    expect(response.status).toBe(415);
  });
});

describe("methods", () => {
  it("says what it answers when asked for something else", async () => {
    const response = await call("/", { method: "DELETE" });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD, POST");
  });
});

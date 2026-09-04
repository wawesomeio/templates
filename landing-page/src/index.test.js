import { describe, expect, it } from "vitest";
import handler, { escapeHtml } from "./index.js";

/** The page as a visitor's browser receives it. */
async function get(path = "/", method = "GET") {
  const response = await handler.fetch(new Request(`https://studio.example${path}`, { method }));
  return { response, body: await response.text() };
}

describe("the page", () => {
  it("answers with markup rather than with a file", async () => {
    const { response, body } = await get();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(body.startsWith("<!doctype html>")).toBe(true);
    expect(body).toContain("Fernwood Ceramics");
  });

  it("carries everything it needs inside the one response", async () => {
    const { body } = await get();

    // No stylesheet link, no script tag, no image: a static asset is a second
    // deploy step, and this template's whole claim is that there isn't one.
    expect(body).toContain("<style>");
    expect(body).not.toMatch(/<link[^>]+stylesheet/);
    expect(body).not.toContain("<script");
  });

  it("carries the attribution as one line anybody can delete", async () => {
    const { body } = await get();

    const attribution = body.split("\n").filter((line) => line.includes("wawesome.io"));
    expect(attribution).toHaveLength(1);
    expect(attribution[0]).toContain("Built with wawesome");
  });

  it("answers at every path beneath the mount", async () => {
    const { response, body } = await get("/anything-somebody-typed");

    expect(response.status).toBe(200);
    expect(body).toContain("Fernwood Ceramics");
  });

  it("answers a HEAD without a body", async () => {
    const { response, body } = await get("/", "HEAD");

    expect(response.status).toBe(200);
    expect(body).toBe("");
  });

  it("refuses a method a page does not have, and says which it has", async () => {
    const { response } = await get("/", "POST");

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
  });
});

describe("the copy", () => {
  it("survives a business whose name is punctuation", () => {
    expect(escapeHtml('Fern & Co "the studio"')).toBe("Fern &amp; Co &quot;the studio&quot;");
    expect(escapeHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

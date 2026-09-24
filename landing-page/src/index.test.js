import { expect, it } from "vitest";
import handler from "./index.js";

it("answers with the page", async () => {
  const response = await handler.fetch(new Request("https://studio.example/"));

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  expect(await response.text()).toContain("<h1>Hand-thrown stoneware, made to be used every day</h1>");
});

it("answers the same page at any path", async () => {
  const response = await handler.fetch(new Request("https://studio.example/about"));

  expect(response.status).toBe(200);
  expect(await response.text()).toContain("Fernwood Ceramics");
});

it("refuses a POST", async () => {
  const response = await handler.fetch(new Request("https://studio.example/", { method: "POST" }));

  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("GET, HEAD");
});

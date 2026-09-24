import { expect, it } from "vitest";
import server from "./server";

it("renders the loader's books into the page", async () => {
  const response = await server.fetch(new Request("http://localhost/"));

  expect(response.status).toBe(200);
  expect(await response.text()).toContain("The Left Hand of Darkness");
});

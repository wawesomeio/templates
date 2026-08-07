import { describe, expect, it } from "vitest";
import { matchRoute, type Route } from "./router.js";

/**
 * The routing table these exercise is a stand-in for the real one, so a test
 * here fails because matching broke rather than because a route was renamed.
 */
const ROUTES: Route<string>[] = [
  { method: "GET", pattern: "/", handler: "list" },
  { method: "POST", pattern: "/", handler: "create" },
  { method: "GET", pattern: "/:id", handler: "read" },
  { method: "PUT", pattern: "/:id", handler: "replace" },
  { method: "DELETE", pattern: "/:id", handler: "delete" },
  { method: "GET", pattern: "/:id/orders", handler: "orders" },
];

const match = (method: string, pathname: string) => matchRoute(ROUTES, method, pathname);

describe("matching a route", () => {
  it("serves the collection at the mount root", () => {
    expect(match("GET", "/")).toEqual({ outcome: "matched", handler: "list", params: {} });
  });

  it("serves an item one segment beneath the mount", () => {
    expect(match("GET", "/cus_42")).toEqual({
      outcome: "matched",
      handler: "read",
      params: { id: "cus_42" },
    });
  });

  it("serves a nested collection two segments beneath the mount", () => {
    expect(match("GET", "/cus_42/orders")).toEqual({
      outcome: "matched",
      handler: "orders",
      params: { id: "cus_42" },
    });
  });

  it("separates the methods on one path", () => {
    for (const [method, handler] of [
      ["GET", "read"],
      ["PUT", "replace"],
      ["DELETE", "delete"],
    ]) {
      expect(match(method!, "/cus_42")).toMatchObject({ handler });
    }
  });

  it("does not confuse a literal segment with a parameter", () => {
    // `/cus_42/orders` and `/cus_42` are different routes, and `orders` is not
    // an id — a matcher that took the first pattern of the right length would
    // get this wrong.
    expect(match("GET", "/orders")).toMatchObject({ handler: "read", params: { id: "orders" } });
    expect(match("GET", "/cus_42/orders")).toMatchObject({ handler: "orders" });
  });
});

describe("a path with no route", () => {
  it("is unmatched rather than answered by something close to it", () => {
    expect(match("GET", "/cus_42/invoices")).toEqual({ outcome: "unmatched" });
  });

  it("is unmatched however deep it goes", () => {
    // Every path beneath the mount reaches this Function, so the ones it does
    // not serve are its own to refuse.
    expect(match("GET", "/a/b/c/d")).toEqual({ outcome: "unmatched" });
  });
});

describe("a path whose method is not served", () => {
  it("reports what the path does serve", () => {
    const result = match("PATCH", "/cus_42");

    expect(result.outcome).toBe("wrong-method");
    expect(result.outcome === "wrong-method" && result.allow.sort()).toEqual(["DELETE", "GET", "PUT"]);
  });

  it("reports the collection's methods, not the item's", () => {
    const result = match("DELETE", "/");

    expect(result.outcome).toBe("wrong-method");
    expect(result.outcome === "wrong-method" && result.allow.sort()).toEqual(["GET", "POST"]);
  });

  it("is a wrong method only where the path exists", () => {
    expect(match("PATCH", "/cus_42/invoices")).toEqual({ outcome: "unmatched" });
  });
});

describe("HEAD", () => {
  it("is served by the route that serves GET", () => {
    expect(match("HEAD", "/cus_42")).toMatchObject({ handler: "read" });
  });

  it("is not invented for a path that has no GET", () => {
    const routes: Route<string>[] = [{ method: "POST", pattern: "/", handler: "create" }];

    expect(matchRoute(routes, "HEAD", "/")).toMatchObject({ outcome: "wrong-method" });
  });
});

/**
 * The platform hands over the path exactly as the caller wrote it — no
 * percent-decoding, no collapsing of doubled separators, no trailing-slash
 * rewriting. Every one of those is therefore this router's decision, and these
 * pin the decisions it made.
 */
describe("a path the platform did not normalise", () => {
  it("treats a trailing slash as the same resource", () => {
    expect(match("GET", "/cus_42/")).toMatchObject({ handler: "read", params: { id: "cus_42" } });
  });

  it("decodes a percent-escaped identifier", () => {
    expect(match("GET", "/cus%2042")).toMatchObject({ params: { id: "cus 42" } });
  });

  it("keeps an encoded separator inside one segment", () => {
    // Splitting after decoding would turn this id into two segments and route
    // it somewhere else entirely.
    expect(match("GET", "/acme%2Feu")).toMatchObject({ handler: "read", params: { id: "acme/eu" } });
  });

  it("refuses a path that is not valid percent-encoding", () => {
    expect(match("GET", "/cus_%zz")).toEqual({ outcome: "undecodable" });
  });

  it("does not read a doubled separator as an item", () => {
    // An empty segment is not an identifier, so this is a 404 rather than a
    // lookup for the customer whose id is the empty string.
    expect(match("GET", "//orders")).toEqual({ outcome: "unmatched" });
  });
});

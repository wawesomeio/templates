import { describe, expect, it } from "vitest";
import { callerUrl, FORWARDED_PREFIX_HEADER, mountUrl, resourceUrl } from "./public-url.js";

const ORIGIN = "https://api.wawesome.io";
const PREFIX = "/x/acme/rest-api/customers";

/** A request as it reaches the guest: prefix stripped, and handed back on a header. */
function arriving(pathAndQuery: string, prefix: string | null = PREFIX): Request {
  return new Request(ORIGIN + pathAndQuery, {
    headers: prefix ? { [FORWARDED_PREFIX_HEADER]: prefix } : {},
  });
}

describe("the Function's own public base", () => {
  it("is the origin it was reached at plus the mount it lost", () => {
    expect(mountUrl(arriving("/"))).toBe(`${ORIGIN}${PREFIX}`);
  });

  it("follows the mount rather than assuming one", () => {
    // A Preview addresses the same code under a different prefix. Nothing here
    // may be compiled in, or a Preview would advertise production's links.
    expect(mountUrl(arriving("/", "/preview/v7/x/acme/rest-api/customers"))).toBe(
      `${ORIGIN}/preview/v7/x/acme/rest-api/customers`,
    );
  });

  it("degrades to the origin when no prefix arrives", () => {
    expect(mountUrl(arriving("/", null))).toBe(ORIGIN);
  });
});

describe("a link to a resource", () => {
  it("hangs the segments off the mount", () => {
    expect(resourceUrl(arriving("/"), "cus_42")).toBe(`${ORIGIN}${PREFIX}/cus_42`);
    expect(resourceUrl(arriving("/"), "cus_42", "orders")).toBe(`${ORIGIN}${PREFIX}/cus_42/orders`);
  });

  it("encodes a segment so the link routes back to the same resource", () => {
    // The mirror of the router's decode: an id carrying a separator has to
    // survive the round trip as one segment.
    expect(resourceUrl(arriving("/"), "acme/eu")).toBe(`${ORIGIN}${PREFIX}/acme%2Feu`);
  });
});

describe("the URL the caller actually typed", () => {
  it("is the origin, the mount, and the path observed after it", () => {
    expect(callerUrl(arriving("/cus_42/orders"))).toBe(`${ORIGIN}${PREFIX}/cus_42/orders`);
  });

  it("keeps the query the caller sent", () => {
    expect(callerUrl(arriving("/cus_42/orders?limit=2"))).toBe(`${ORIGIN}${PREFIX}/cus_42/orders?limit=2`);
  });

  it("gains the one slash at the bare mount that no URL can express", () => {
    // Pinned as a known shape rather than left as a surprise: a caller who
    // addressed the mount itself is read back as `/` by the parsers on both
    // sides of the boundary, so this is the one address reconstruction does not
    // return byte for byte.
    expect(callerUrl(arriving("/?limit=2"))).toBe(`${ORIGIN}${PREFIX}/?limit=2`);
  });

  it("keeps an escape unnormalised, so a signature over the URL still verifies", () => {
    expect(callerUrl(arriving("/acme%2Feu"))).toBe(`${ORIGIN}${PREFIX}/acme%2Feu`);
  });
});

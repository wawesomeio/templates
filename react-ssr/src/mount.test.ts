import { describe, expect, it } from "vitest";
import { assetUrl, baseOf, callerUrl, FORWARDED_PREFIX_HEADER } from "./mount.js";

/** A request as the platform hands it over: mount stripped, prefix on the header. */
function arriving(path: string, prefix?: string): Request {
  return new Request(`https://acme--shop.wawesome.app${path}`, {
    headers: prefix === undefined ? {} : { [FORWARDED_PREFIX_HEADER]: prefix },
  });
}

describe("the mount a request arrived under", () => {
  it("is whatever the platform stripped, and nothing at the root", () => {
    expect(baseOf(arriving("/", "/checkout"))).toBe("/checkout");
    expect(baseOf(arriving("/"))).toBe("");
  });

  /**
   * The same build, four addresses. This is the whole reason the base is read
   * per request instead of written into the bundle.
   */
  it("puts each address's own prefix on the same file", () => {
    const file = "assets/index-B7f2a1.js";

    expect(assetUrl(baseOf(arriving("/")), file)).toBe("/assets/index-B7f2a1.js");
    expect(assetUrl(baseOf(arriving("/", "/storefront")), file)).toBe(
      "/storefront/assets/index-B7f2a1.js",
    );
    expect(assetUrl(baseOf(arriving("/", "/_preview/storefront@7")), file)).toBe(
      "/_preview/storefront@7/assets/index-B7f2a1.js",
    );
    expect(assetUrl(baseOf(arriving("/", "/x/acme/shop/storefront")), file)).toBe(
      "/x/acme/shop/storefront/assets/index-B7f2a1.js",
    );
  });

  it("joins a file the caller wrote with a leading slash exactly once", () => {
    expect(assetUrl("/shop", "/wawesome.svg")).toBe("/shop/wawesome.svg");
    expect(assetUrl("/shop", "wawesome.svg")).toBe("/shop/wawesome.svg");
  });

  it("reassembles the address the caller typed from the pieces the Function holds", () => {
    expect(callerUrl(arriving("/orders/42?tab=items", "/storefront"))).toBe(
      "/storefront/orders/42?tab=items",
    );
  });
});

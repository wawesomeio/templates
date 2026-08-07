import { describe, expect, it } from "vitest";
import handler from "./index.js";
import { FORWARDED_PREFIX_HEADER } from "./public-url.js";

const ORIGIN = "https://api.wawesome.io";

/**
 * The mount this Function is deployed at.
 *
 * The platform strips it before the request arrives, so every path below is
 * written the way the Function actually observes it — `/` is the Function's own
 * address, not the gateway's root.
 */
const MOUNT = "/x/acme/rest-api/customers";

const SEEDED = "cus_amelia";
const MISSING = "cus_nobody";

function call(
  method: string,
  path: string,
  { body, contentType = "application/json", prefix = MOUNT as string | null } = {} as {
    body?: string;
    contentType?: string | null;
    prefix?: string | null;
  },
): Promise<Response> {
  return handler.fetch(
    new Request(ORIGIN + path, {
      method,
      headers: {
        ...(contentType ? { "Content-Type": contentType } : {}),
        ...(prefix ? { [FORWARDED_PREFIX_HEADER]: prefix } : {}),
      },
      body,
    }),
  );
}

const draft = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({ name: "Nadia Petrova", email: "nadia@example.com", ...fields });

describe("the collection", () => {
  it("is served at the Function's own address", async () => {
    const response = await call("GET", "/");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(payload.data.length);
    expect(payload.data.length).toBeGreaterThan(0);
  });

  it("gives every item the address it can be fetched back from", async () => {
    const payload = await (await call("GET", "/")).json();
    const [first] = payload.data;

    expect(first.self).toBe(`${ORIGIN}${MOUNT}/${first.id}`);

    const followed = await call("GET", `/${first.id}`);
    expect(followed.status).toBe(200);
    expect((await followed.json()).id).toBe(first.id);
  });
});

describe("an item", () => {
  it("is served one segment beneath the mount", async () => {
    const response = await call("GET", `/${SEEDED}`);

    expect(response.status).toBe(200);
    expect((await response.json()).id).toBe(SEEDED);
  });

  it("is a 404 when there is no such customer", async () => {
    const response = await call("GET", `/${MISSING}`);

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("No such customer.");
  });
});

describe("the collection nested under an item", () => {
  it("is served two segments beneath the mount", async () => {
    const response = await call("GET", `/${SEEDED}/orders`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.every((order: { customer_id: string }) => order.customer_id === SEEDED)).toBe(true);
  });

  it("distinguishes a customer with no orders from no customer at all", async () => {
    const response = await call("GET", `/${MISSING}/orders`);

    expect(response.status).toBe(404);
  });
});

describe("creating one", () => {
  it("answers 201 with the address the resource would have", async () => {
    const response = await call("POST", "/", { body: draft() });
    const created = await response.json();

    expect(response.status).toBe(201);
    expect(created.name).toBe("Nadia Petrova");
    expect(response.headers.get("Location")).toBe(`${ORIGIN}${MOUNT}/${created.id}`);
  });

  it("refuses a draft it cannot store", async () => {
    expect((await call("POST", "/", { body: draft({ email: "nadia" }) })).status).toBe(400);
    expect((await call("POST", "/", { body: draft(), contentType: "text/plain" })).status).toBe(415);
  });
});

describe("replacing one", () => {
  it("answers with the customer as it would then read", async () => {
    const response = await call("PUT", `/${SEEDED}`, { body: draft() });
    const replaced = await response.json();

    expect(response.status).toBe(200);
    expect(replaced.id).toBe(SEEDED);
    expect(replaced.name).toBe("Nadia Petrova");
  });

  it("round-trips a customer read back from a GET", async () => {
    const fetched = await (await call("GET", `/${SEEDED}`)).json();

    const response = await call("PUT", `/${SEEDED}`, { body: JSON.stringify(fetched) });

    expect(response.status).toBe(200);
  });

  it("is a 404 when there is no such customer", async () => {
    expect((await call("PUT", `/${MISSING}`, { body: draft() })).status).toBe(404);
  });
});

describe("deleting one", () => {
  it("answers 204 with no body", async () => {
    const response = await call("DELETE", `/${SEEDED}`);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("is a 404 when there is no such customer", async () => {
    expect((await call("DELETE", `/${MISSING}`)).status).toBe(404);
  });
});

/**
 * The whole point of the mount: every URL beneath the address reaches this
 * Function, so the ones it does not serve are its own to answer.
 */
describe("a path the Function does not serve", () => {
  it("is answered by the Function with its own 404", async () => {
    for (const path of ["/cus_amelia/invoices", "/a/b/c/d", "/health"]) {
      const response = await call("GET", path);

      expect(response.status, path).toBe(404);
      expect((await response.json()).error).toBe(path === "/health" ? "No such customer." : "No such resource.");
    }
  });

  it("never quotes the path back at the caller", async () => {
    const response = await call("GET", "/%3Cscript%3Ealert(1)%3C%2Fscript%3E/invoices");

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("script");
  });

  it("refuses a path that is not valid percent-encoding", async () => {
    expect((await call("GET", "/cus_%zz")).status).toBe(400);
  });
});

describe("a method the path does not serve", () => {
  it("is a 405 that says what the path does serve", async () => {
    const response = await call("PATCH", `/${SEEDED}`, { body: draft() });

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("DELETE, GET, HEAD, OPTIONS, PUT");
  });

  it("advertises the collection's methods at the collection", async () => {
    const response = await call("DELETE", "/");

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD, OPTIONS, POST");
  });
});

describe("the methods a REST client expects to work without being routed", () => {
  it("answers OPTIONS with what the path allows", async () => {
    const response = await call("OPTIONS", `/${SEEDED}`);

    expect(response.status).toBe(204);
    expect(response.headers.get("Allow")).toBe("DELETE, GET, HEAD, OPTIONS, PUT");
  });

  it("answers HEAD with the GET status and no body", async () => {
    const found = await call("HEAD", `/${SEEDED}`);
    expect(found.status).toBe(200);
    expect(await found.text()).toBe("");

    expect((await call("HEAD", `/${MISSING}`)).status).toBe(404);
  });
});

/**
 * A Preview addresses the same code under a different prefix. If any of this
 * were compiled in, a Preview would stop being a rehearsal of production.
 */
describe("the addressing the Function does not hardcode", () => {
  it("builds its links from the mount it was actually reached at", async () => {
    const preview = "/preview/v7/x/acme/rest-api/customers";

    const response = await call("POST", "/", { body: draft(), prefix: preview });
    const created = await response.json();

    expect(response.headers.get("Location")).toBe(`${ORIGIN}${preview}/${created.id}`);
  });

  it("routes on the same paths whatever the mount is", async () => {
    const response = await call("GET", `/${SEEDED}`, { prefix: "/somewhere/else/entirely" });

    expect(response.status).toBe(200);
  });
});

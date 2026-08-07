import { describe, expect, it } from "vitest";
import { LIMITS, parseCustomerDraft } from "./validate.js";

const parse = (body: unknown, contentType: string | null = "application/json") =>
  parseCustomerDraft(contentType, typeof body === "string" ? body : JSON.stringify(body));

const valid = { name: "Amelia Okonkwo", email: "amelia@example.com" };

describe("a well-formed draft", () => {
  it("is accepted", () => {
    expect(parse(valid)).toEqual({ ok: true, value: valid });
  });

  it("is accepted with a charset on the content type", () => {
    expect(parse(valid, "application/json; charset=utf-8")).toMatchObject({ ok: true });
  });

  it("keeps only the fields a client may set", () => {
    // A PUT of a customer read back from a GET carries the server's own fields.
    // Round-tripping is the ordinary way to use a REST API, so they are ignored
    // rather than refused — but they are not honoured either.
    const result = parse({ ...valid, id: "cus_forged", created_at: "1999-01-01T00:00:00.000Z", self: "…" });

    expect(result).toEqual({ ok: true, value: valid });
  });

  it("trims surrounding whitespace", () => {
    expect(parse({ name: "  Amelia Okonkwo  ", email: " amelia@example.com " })).toEqual({
      ok: true,
      value: valid,
    });
  });
});

describe("a draft that cannot be stored", () => {
  it("refuses a body that is not JSON at all", () => {
    expect(parse("not json")).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a JSON value that is not an object", () => {
    expect(parse([valid])).toMatchObject({ ok: false, status: 400 });
    expect(parse("null")).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a missing or empty field", () => {
    expect(parse({ email: valid.email })).toMatchObject({ ok: false, status: 400 });
    expect(parse({ ...valid, name: "   " })).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a field of the wrong type", () => {
    expect(parse({ ...valid, name: 42 })).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses an address that is not one", () => {
    expect(parse({ ...valid, email: "amelia" })).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a field it does not know", () => {
    expect(parse({ ...valid, is_admin: true })).toMatchObject({ ok: false, status: 400 });
  });
});

describe("the envelope", () => {
  it("refuses a content type it cannot parse", () => {
    expect(parse(valid, "text/plain")).toMatchObject({ ok: false, status: 415 });
    expect(parse(valid, null)).toMatchObject({ ok: false, status: 415 });
  });

  it("refuses an oversized body before parsing it", () => {
    const oversized = JSON.stringify({ ...valid, name: "x".repeat(LIMITS.maxBodyChars) });

    expect(parse(oversized)).toMatchObject({ ok: false, status: 413 });
  });
});

describe("a refusal", () => {
  it("never quotes what the client sent", () => {
    // A refusal that echoes its input is a way to make a public endpoint reflect
    // a stranger's text back into somebody else's page.
    const hostile = "<script>alert(1)</script>";
    const result = parse({ ...valid, email: hostile });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).not.toContain(hostile);
  });
});

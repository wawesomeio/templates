import { describe, expect, it } from "vitest";
import { limits, readEnquiry } from "./enquiry.js";

const valid = { name: "Priya Shah", email: "priya@example.com", message: "A small courtyard, mostly shade." };

describe("an enquiry", () => {
  it("is accepted with all three fields, trimmed", () => {
    expect(readEnquiry({ name: "  Priya Shah ", email: " priya@example.com", message: valid.message })).toEqual({
      enquiry: valid,
    });
  });

  it("keeps only the fields the table has", () => {
    expect(readEnquiry({ ...valid, id: "forged", created_at: "1999-01-01" })).toEqual({ enquiry: valid });
  });
});

describe("an enquiry that cannot be kept", () => {
  it.each([
    [{ ...valid, name: "" }, "name"],
    [{ ...valid, name: "   " }, "name"],
    [{ ...valid, name: "x".repeat(limits.name + 1) }, "name"],
    [{ ...valid, email: "priya" }, "email"],
    [{ ...valid, email: "priya@example" }, "email"],
    [{ ...valid, email: "priya shah@example.com" }, "email"],
    [{ ...valid, message: 42 }, "message"],
    [{ ...valid, message: "x".repeat(limits.message + 1) }, "message"],
  ])("names the one field that failed in %o", (submitted, field) => {
    const read = readEnquiry(submitted);

    expect("errors" in read && Object.keys(read.errors)).toEqual([field]);
  });

  it("names every field that failed at once, so the visitor fixes them in one go", () => {
    const read = readEnquiry({});

    expect("errors" in read && Object.keys(read.errors)).toEqual(["name", "email", "message"]);
  });

  it("hands back what was typed, so the form can be shown again filled in", () => {
    const read = readEnquiry({ ...valid, email: "priya" });

    expect("values" in read && read.values).toEqual({ ...valid, email: "priya" });
  });
});

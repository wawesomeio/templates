import { describe, expect, it } from "vitest";
import { readPricing, readUsage, usageLine } from "./usage.js";

const USAGE = { prompt: 412, completion: 118, total: 530 };

describe("readUsage", () => {
  it("reads the usage block an OpenAI-compatible response carries", () => {
    expect(readUsage({ usage: { prompt_tokens: 412, completion_tokens: 118, total_tokens: 530 } })).toEqual(USAGE);
  });

  it("totals the parts itself when the provider does not", () => {
    // "OpenAI-compatible" is a spectrum. A provider that omits total_tokens is
    // not a reason to log nothing about what the request cost.
    expect(readUsage({ usage: { prompt_tokens: 10, completion_tokens: 5 } })).toEqual({
      prompt: 10,
      completion: 5,
      total: 15,
    });
  });

  it("reports nothing rather than zero when the provider sent no usage", () => {
    // Zero would read as a free request in the logs, which is the one number
    // this must never invent.
    expect(readUsage({})).toBeNull();
    expect(readUsage({ usage: { prompt_tokens: "lots" } })).toBeNull();
    expect(readUsage(null)).toBeNull();
  });
});

describe("readPricing", () => {
  it("reads a pair of per-million rates", () => {
    expect(readPricing({ USD_PER_MILLION_INPUT_TOKENS: "0.15", USD_PER_MILLION_OUTPUT_TOKENS: "0.60" })).toEqual({
      inputPerMillion: 0.15,
      outputPerMillion: 0.6,
    });
  });

  it("needs both rates, so a half-configured price never becomes a wrong one", () => {
    expect(readPricing({ USD_PER_MILLION_INPUT_TOKENS: "0.15" })).toBeNull();
    expect(readPricing({})).toBeNull();
  });

  it("ignores rates that are not usable numbers", () => {
    expect(readPricing({ USD_PER_MILLION_INPUT_TOKENS: "cheap", USD_PER_MILLION_OUTPUT_TOKENS: "0.60" })).toBeNull();
    expect(readPricing({ USD_PER_MILLION_INPUT_TOKENS: "-1", USD_PER_MILLION_OUTPUT_TOKENS: "0.60" })).toBeNull();
  });
});

describe("usageLine", () => {
  it("puts the tokens for this one request on one line", () => {
    expect(usageLine({ model: "gpt-4o-mini", usage: USAGE, elapsedMs: 1843 })).toBe(
      "usage model=gpt-4o-mini prompt_tokens=412 completion_tokens=118 total_tokens=530 ms=1843",
    );
  });

  it("adds what those tokens cost once the rates are configured", () => {
    const line = usageLine({
      model: "gpt-4o-mini",
      usage: USAGE,
      elapsedMs: 1843,
      pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
    });
    // 412/1e6 * 0.15 + 118/1e6 * 0.60 = 0.0001326
    expect(line).toContain("cost_usd=0.000133");
  });

  it("says the tokens are unknown rather than logging a number nobody sent", () => {
    expect(usageLine({ model: "gpt-4o-mini", usage: null, elapsedMs: 90 })).toBe(
      "usage model=gpt-4o-mini tokens=unreported ms=90",
    );
  });
});

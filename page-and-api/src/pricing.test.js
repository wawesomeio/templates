import { describe, it, expect } from "vitest";
import { prices, limits, readOrder, quote } from "./pricing.js";

describe("reading an order", () => {
  it("takes the three fields the form sends", () => {
    expect(readOrder({ quantity: 250, colours: 2, rush: true })).toEqual({
      order: { quantity: 250, colours: 2, rush: true },
    });
  });

  it("treats a missing rush as no rush, which is what the unticked box means", () => {
    expect(readOrder({ quantity: 250, colours: 1 })).toEqual({
      order: { quantity: 250, colours: 1, rush: false },
    });
  });

  it.each([
    [{ quantity: "250", colours: 1 }, "quantity"],
    [{ quantity: 250.5, colours: 1 }, "quantity"],
    [{ quantity: limits.quantity.min - 1, colours: 1 }, "quantity"],
    [{ quantity: limits.quantity.max + 1, colours: 1 }, "quantity"],
    [{ quantity: 250, colours: 0 }, "colours"],
    [{ quantity: 250, colours: limits.colours.max + 1 }, "colours"],
    [{ quantity: 250, colours: 1, rush: "yes" }, "rush"],
  ])("refuses %o and names the field", (body, field) => {
    const read = readOrder(body);
    expect(read).toMatchObject({ field });
    expect("order" in read).toBe(false);
  });

  it.each([[null], [[]], ["250 cards"], [42]])("refuses %o, which is not an order at all", (body) => {
    expect(readOrder(body)).toMatchObject({ field: "body" });
  });
});

describe("pricing a run", () => {
  it("charges make-ready once per colour and the rest by the card", () => {
    const priced = quote({ quantity: 250, colours: 2, rush: false });

    expect(priced.lines).toEqual([
      { label: "Plates and make-ready, 2 colours", pence: prices.setup_per_colour_pence * 2 },
      { label: "250 cards at 34p", pence: 34 * 250 },
    ]);
    expect(priced.total_pence).toBe(prices.setup_per_colour_pence * 2 + 34 * 250);
    expect(priced.lead_time_days).toBe(prices.lead_time_days.standard);
  });

  it("names one colour in the singular, because a quote a customer reads is copy", () => {
    expect(quote({ quantity: 100, colours: 1, rush: false }).lines[0].label).toBe(
      "Plates and make-ready, 1 colour",
    );
  });

  it("drops the rate as the run gets longer", () => {
    const rates = [100, 500, 1000].map((quantity) => {
      const [, cards] = quote({ quantity, colours: 1, rush: false }).lines;
      return cards.pence / quantity;
    });

    expect(rates).toEqual([42, 34, 26]);
  });

  it("adds the rush surcharge to everything before it, and brings the date forward", () => {
    const standard = quote({ quantity: 250, colours: 2, rush: false });
    const rushed = quote({ quantity: 250, colours: 2, rush: true });

    expect(rushed.lines.at(-1)).toEqual({
      label: `Rush, in ${prices.lead_time_days.rush} working days`,
      pence: Math.round(standard.total_pence * prices.rush_surcharge),
    });
    expect(rushed.total_pence).toBe(
      standard.total_pence + Math.round(standard.total_pence * prices.rush_surcharge),
    );
    expect(rushed.lead_time_days).toBe(prices.lead_time_days.rush);
  });

  it("answers in whole pence, so no line arrives as a fraction of one", () => {
    for (const quantity of [25, 33, 137, 4999]) {
      for (const rush of [false, true]) {
        const priced = quote({ quantity, colours: 3, rush });
        for (const line of priced.lines) expect(Number.isInteger(line.pence)).toBe(true);
      }
    }
  });
});

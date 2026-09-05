/**
 * What the studio charges. The one reason this endpoint exists rather than a
 * few lines of JavaScript on the page: change a rate here and every visitor is
 * quoted the new one on the next deploy, with nothing cached in anybody's
 * browser and nothing to reconcile between two versions of the price list.
 */
export const prices = {
  currency: "GBP",
  /** A plate is cut and made ready once per colour, whatever the run length. */
  setup_per_colour_pence: 4500,
  /** Charged per card, at the rate the whole run falls into. */
  tiers: [
    { up_to: 100, pence: 42 },
    { up_to: 500, pence: 34 },
    { up_to: Infinity, pence: 26 },
  ],
  rush_surcharge: 0.25,
  lead_time_days: { standard: 15, rush: 5 },
};

export const limits = {
  quantity: { min: 25, max: 5000 },
  colours: { min: 1, max: 3 },
};

/**
 * @typedef {object} Order
 * @property {number} quantity
 * @property {number} colours
 * @property {boolean} rush
 *
 * @typedef {object} Line
 * @property {string} label
 * @property {number} pence
 *
 * @typedef {object} Quote
 * @property {string} currency
 * @property {number} quantity
 * @property {number} colours
 * @property {boolean} rush
 * @property {Line[]} lines
 * @property {number} total_pence
 * @property {number} lead_time_days
 *
 * @typedef {object} Accepted
 * @property {Order} order
 *
 * @typedef {object} Refused
 * @property {string} problem
 * @property {string} field
 *
 * @typedef {object} Range
 * @property {number} min
 * @property {number} max
 */

/**
 * Read an order out of whatever arrived on the wire.
 *
 * @param {unknown} body
 * @returns {Accepted | Refused}
 */
export function readOrder(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { problem: "Send a JSON object naming quantity, colours and rush.", field: "body" };
  }

  const { quantity, colours, rush = false } = /** @type {Record<string, unknown>} */ (body);

  const quantityProblem = whole(quantity, limits.quantity, "quantity", "cards");
  if (quantityProblem) return { problem: quantityProblem, field: "quantity" };

  const colourProblem = whole(colours, limits.colours, "colours", "colours");
  if (colourProblem) return { problem: colourProblem, field: "colours" };

  if (typeof rush !== "boolean") {
    return { problem: "rush is true or false.", field: "rush" };
  }

  return { order: { quantity: Number(quantity), colours: Number(colours), rush } };
}

/**
 * @param {unknown} value
 * @param {Range} range
 * @param {string} field
 * @param {string} unit
 * @returns {string | null}
 */
function whole(value, range, field, unit) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return `${field} is a whole number of ${unit}.`;
  }
  if (value < range.min || value > range.max) {
    return `${field} is between ${range.min} and ${range.max} ${unit}. Ask us about anything outside that.`;
  }
  return null;
}

/**
 * @param {Order} order
 * @returns {Quote}
 */
export function quote({ quantity, colours, rush }) {
  const rate = rateFor(quantity);

  const lines = [
    {
      label: `Plates and make-ready, ${colours} ${colours === 1 ? "colour" : "colours"}`,
      pence: prices.setup_per_colour_pence * colours,
    },
    { label: `${quantity} cards at ${rate}p`, pence: rate * quantity },
  ];

  if (rush) {
    const surcharge = Math.round(sum(lines) * prices.rush_surcharge);
    lines.push({ label: `Rush, in ${prices.lead_time_days.rush} working days`, pence: surcharge });
  }

  return {
    currency: prices.currency,
    quantity,
    colours,
    rush,
    lines,
    total_pence: sum(lines),
    lead_time_days: rush ? prices.lead_time_days.rush : prices.lead_time_days.standard,
  };
}

/**
 * @param {number} quantity
 * @returns {number}
 */
function rateFor(quantity) {
  const tier = prices.tiers.find(({ up_to }) => quantity <= up_to);
  return (tier ?? prices.tiers[prices.tiers.length - 1]).pence;
}

/**
 * @param {Line[]} lines
 * @returns {number}
 */
function sum(lines) {
  return lines.reduce((total, line) => total + line.pence, 0);
}

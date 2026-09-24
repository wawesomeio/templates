import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "./index.js";

const SECRET = "whsec_test_secret";

const payload = JSON.stringify({
  id: "evt_test",
  type: "payment_intent.succeeded",
  data: { object: { id: "pi_test", amount_received: 4200, currency: "eur" } },
});

function signatureFor(body: string): Promise<string> {
  return Stripe.webhooks.generateTestHeaderStringAsync({
    payload: body,
    secret: SECRET,
    cryptoProvider: Stripe.createSubtleCryptoProvider(),
  });
}

function post(body: string, signature?: string): Promise<Response> {
  return handler.fetch(
    new Request("https://example.com/", {
      method: "POST",
      headers: signature ? { "Stripe-Signature": signature } : {},
      body,
    }),
  );
}

describe("stripe-webhook", () => {
  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    vi.restoreAllMocks();
  });

  it("accepts a signed event", async () => {
    const response = await post(payload, await signatureFor(payload));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
  });

  it("refuses a body changed after it was signed", async () => {
    const signature = await signatureFor(payload);
    const response = await post(payload.replace("4200", "9999"), signature);

    expect(response.status).toBe(400);
  });

  it("refuses a request with no signature", async () => {
    const response = await post(payload);

    expect(response.status).toBe(400);
  });

  it("answers 500 and logs the fix when the secret is not set", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const response = await post(payload, await signatureFor(payload));

    expect(response.status).toBe(500);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("wawesome env set STRIPE_WEBHOOK_SECRET"));
  });
});

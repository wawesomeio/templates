import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "./index.js";
import { stripeSignatureHeader } from "./stripe-signature.fixture.js";

const SECRET = "whsec_ZmFrZV90ZXN0X3NpZ25pbmdfc2VjcmV0";

const EVENT = {
  id: "evt_test",
  type: "payment_intent.succeeded",
  data: { object: { id: "pi_test", amount_received: 4200, currency: "eur" } },
};

const ADDRESS = "https://gateway.example/x/acme/stripe-webhook/stripe-events";

const now = () => Math.floor(Date.now() / 1000);

function signed(payload: string): Promise<string> {
  return stripeSignatureHeader(payload, now(), SECRET);
}

function post(payload: string, header: string | null): Promise<Response> {
  return handler.fetch(
    new Request(ADDRESS, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(header ? { "Stripe-Signature": header } : {}),
      },
      body: payload,
    }),
  );
}

describe("the webhook endpoint", () => {
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

  it("accepts an event signed the way Stripe signs it, off the header Stripe sends", async () => {
    const payload = JSON.stringify(EVENT);
    const response = await post(payload, await signed(payload));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
  });

  it("verifies the bytes as sent, not a re-serialised copy of them", async () => {
    const payload = '{\n  "id": "evt_test",\r\n  "note": "\\u2028 üñí",\n  "type": "ping"  }\n';
    const response = await post(payload, await signed(payload));

    expect(response.status).toBe(200);
  });

  it("refuses a body edited after it was signed", async () => {
    const payload = JSON.stringify(EVENT);
    const header = await signed(payload);
    const response = await post(payload.replace("4200", "9999999"), header);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Signature verification failed." });
  });

  it("refuses a request carrying no signature at all", async () => {
    const response = await post(JSON.stringify(EVENT), null);

    expect(response.status).toBe(400);
  });

  it("refuses any method other than POST", async () => {
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const response = await handler.fetch(new Request(ADDRESS, { method }));

      expect(response.status, `${method} was not refused`).toBe(405);
    }
  });

  it("fails closed when the signing secret has not been set", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const payload = JSON.stringify(EVENT);
    const response = await post(payload, await signed(payload));

    expect(response.status).toBe(500);
  });
});

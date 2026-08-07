import { describe, expect, it } from "vitest";
import { DEFAULT_TOLERANCE_SECONDS, verifyStripeSignature } from "./stripe-signature.js";
import { stripeSignature, stripeSignatureHeader } from "./stripe-signature.fixture.js";

const SECRET = "whsec_ZmFrZV90ZXN0X3NpZ25pbmdfc2VjcmV0";
const PAYLOAD = JSON.stringify({ id: "evt_test", type: "payment_intent.succeeded" });
const TIMESTAMP = 1_700_000_000;

function signatureFor(payload = PAYLOAD, timestamp = TIMESTAMP, secret = SECRET): Promise<string> {
  return stripeSignature(payload, timestamp, secret);
}

function headerFor(payload = PAYLOAD, timestamp = TIMESTAMP, secret = SECRET): Promise<string> {
  return stripeSignatureHeader(payload, timestamp, secret);
}

function verify(header: string | null, overrides: { payload?: string; nowSeconds?: number } = {}) {
  return verifyStripeSignature({
    payload: overrides.payload ?? PAYLOAD,
    header,
    secret: SECRET,
    nowSeconds: overrides.nowSeconds ?? TIMESTAMP,
  });
}

describe("verifyStripeSignature", () => {
  it("accepts a signature Stripe would have produced", async () => {
    await expect(verify(await headerFor())).resolves.toEqual({ ok: true });
  });

  it("accepts the signature anywhere in the header, alongside the schemes it does not know", async () => {
    const signature = await signatureFor();
    const header = `t=${TIMESTAMP},v0=0000000000000000000000000000000000000000000000000000000000000000,v1=${signature}`;

    await expect(verify(header)).resolves.toEqual({ ok: true });
  });

  it("accepts either signature while a signing secret is being rotated", async () => {
    // Stripe sends one v1 per active secret during a rollover, and only the one
    // for *our* secret will match.
    const other = "0".repeat(64);
    const mine = await signatureFor();

    await expect(verify(`t=${TIMESTAMP},v1=${other},v1=${mine}`)).resolves.toEqual({ ok: true });
    await expect(verify(`t=${TIMESTAMP},v1=${mine},v1=${other}`)).resolves.toEqual({ ok: true });
  });

  it("rejects a payload edited after signing", async () => {
    const header = await headerFor();
    const tampered = PAYLOAD.replace("evt_test", "evt_evil");

    await expect(verify(header, { payload: tampered })).resolves.toMatchObject({
      ok: false,
      reason: "no_matching_signature",
    });
  });

  it("rejects a signature made with a different secret", async () => {
    await expect(verify(await headerFor(PAYLOAD, TIMESTAMP, "whsec_someone_elses_secret"))).resolves.toMatchObject({
      ok: false,
      reason: "no_matching_signature",
    });
  });

  it("rejects a signature bound to a different timestamp than the header claims", async () => {
    // The timestamp is part of the signed payload, so re-labelling a captured
    // request to look recent invalidates it — this is what stops a replay.
    const signature = await signatureFor();

    await expect(verify(`t=${TIMESTAMP + 1},v1=${signature}`, { nowSeconds: TIMESTAMP + 1 })).resolves.toMatchObject({
      ok: false,
      reason: "no_matching_signature",
    });
  });

  it("rejects a request captured and replayed outside the tolerance window", async () => {
    const header = await headerFor();

    await expect(
      verify(header, { nowSeconds: TIMESTAMP + DEFAULT_TOLERANCE_SECONDS + 1 }),
    ).resolves.toMatchObject({ ok: false, reason: "timestamp_outside_tolerance" });
  });

  it("accepts a request that is old but still inside the tolerance window", async () => {
    await expect(
      verify(await headerFor(), { nowSeconds: TIMESTAMP + DEFAULT_TOLERANCE_SECONDS }),
    ).resolves.toEqual({ ok: true });
  });

  it("accepts a future-dated timestamp, so a slow receiver clock does not drop live events", async () => {
    await expect(
      verify(await headerFor(), { nowSeconds: TIMESTAMP - DEFAULT_TOLERANCE_SECONDS * 10 }),
    ).resolves.toEqual({ ok: true });
  });

  it("honours a caller-supplied tolerance", async () => {
    const header = await headerFor();

    await expect(
      verifyStripeSignature({
        payload: PAYLOAD,
        header,
        secret: SECRET,
        nowSeconds: TIMESTAMP + 61,
        toleranceSeconds: 60,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "timestamp_outside_tolerance" });
  });

  it("reports a missing header separately from a bad one", async () => {
    await expect(verify(null)).resolves.toMatchObject({ ok: false, reason: "missing_header" });
    await expect(verify("")).resolves.toMatchObject({ ok: false, reason: "missing_header" });
  });

  it.each([
    ["no recognisable pairs", "not-a-signature-header"],
    ["no timestamp", `v1=${"a".repeat(64)}`],
    ["no v1 signature", `t=${TIMESTAMP},v0=${"a".repeat(64)}`],
    ["a non-numeric timestamp", `t=yesterday,v1=${"a".repeat(64)}`],
    ["an empty timestamp", `t=,v1=${"a".repeat(64)}`],
  ])("rejects a header with %s", async (_case, header) => {
    await expect(verify(header)).resolves.toMatchObject({ ok: false, reason: "malformed_header" });
  });

  it("takes the last timestamp when a header carries more than one", async () => {
    // Matches stripe-node, which also lets a later `t` win. Harmless either way:
    // the timestamp is inside the signed message, so a value the signature was
    // not made with cannot verify.
    const signature = await signatureFor();

    await expect(verify(`t=${TIMESTAMP - 9999},t=${TIMESTAMP},v1=${signature}`)).resolves.toEqual({ ok: true });
  });

  it("does not silently repair a header padded with spaces", async () => {
    // Stripe never sends one, and quietly trimming would mean accepting input
    // that did not come from Stripe in the shape Stripe sends it.
    const signature = await signatureFor();

    await expect(verify(`t=${TIMESTAMP}, v1=${signature}`)).resolves.toMatchObject({
      ok: false,
      reason: "malformed_header",
    });
  });

  it("rejects a truncated signature without throwing on the length mismatch", async () => {
    const signature = await signatureFor();

    await expect(verify(`t=${TIMESTAMP},v1=${signature.slice(0, 32)}`)).resolves.toMatchObject({
      ok: false,
      reason: "no_matching_signature",
    });
  });

  it("carries a message explaining every rejection", async () => {
    const result = await verify(null);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
  });

  it("verifies the exact bytes it was given, not a re-encoded copy", async () => {
    // Stripe signs the raw request body. Any whitespace or escape the receiver
    // normalises away would change the digest, so the verifier must never parse
    // and re-serialise the payload.
    const raw = '{\n  "id": "evt_test",\r\n  "note": "\\u2028 üñí"  }\n';

    await expect(
      verifyStripeSignature({
        payload: raw,
        header: await headerFor(raw),
        secret: SECRET,
        nowSeconds: TIMESTAMP,
      }),
    ).resolves.toEqual({ ok: true });
  });
});

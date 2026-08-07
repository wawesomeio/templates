/**
 * Signs the way Stripe does, so the tests exercise the real scheme rather than
 * the verifier's own idea of it — which is why the HMAC is written out here
 * instead of calling into `stripe-signature.ts`.
 */
export async function stripeSignature(payload: string, timestamp: number, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));

  return Array.from(new Uint8Array(mac))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function stripeSignatureHeader(
  payload: string,
  timestamp: number,
  secret: string,
): Promise<string> {
  return `t=${timestamp},v1=${await stripeSignature(payload, timestamp, secret)}`;
}

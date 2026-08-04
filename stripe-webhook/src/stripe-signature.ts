/**
 * Verification of Stripe's `Stripe-Signature` header.
 *
 * Stripe signs `${timestamp}.${rawBody}` with HMAC-SHA256 keyed by the
 * endpoint's signing secret, and sends the result as
 * `t=<timestamp>,v1=<hex>[,v1=<hex>…]`. Verifying it is the only thing standing
 * between a public URL and anyone who can POST JSON at it, so this module does
 * the whole job — timestamp window, every offered `v1`, constant-time compare —
 * and nothing else.
 *
 * Implemented on WebCrypto rather than Stripe's SDK: the SDK's verifier reaches
 * for Node's `crypto` module, which does not exist in this runtime.
 */

/** Stripe's own default replay window. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export type SignatureFailureReason =
  | "missing_header"
  | "malformed_header"
  | "timestamp_outside_tolerance"
  | "no_matching_signature";

export type VerificationResult =
  | { ok: true }
  | { ok: false; reason: SignatureFailureReason; message: string };

export interface VerifyStripeSignatureOptions {
  /** The request body exactly as it arrived — never a re-serialised copy. */
  payload: string;
  /** The incoming `Stripe-Signature` header, or null when it is absent. */
  header: string | null | undefined;
  /** The endpoint's signing secret (`whsec_…`) — not your Stripe API key. */
  secret: string;
  /** How far in the past a signed timestamp may be. */
  toleranceSeconds?: number;
  /** Current time, for tests. Defaults to the system clock. */
  nowSeconds?: number;
}

export async function verifyStripeSignature({
  payload,
  header,
  secret,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1000),
}: VerifyStripeSignatureOptions): Promise<VerificationResult> {
  if (!header) {
    return fail("missing_header", "No Stripe-Signature header was sent.");
  }

  const parsed = parseSignatureHeader(header);
  if (!parsed) {
    return fail("malformed_header", "The Stripe-Signature header carried no timestamp and v1 signature.");
  }

  const age = nowSeconds - parsed.timestamp;
  if (age > toleranceSeconds) {
    // Only *old* is rejected, which is what a replay looks like. A future-dated
    // timestamp is left alone deliberately: it means our clock trails Stripe's,
    // and dropping live events over a few seconds of skew would be worse than
    // the replay risk it does not actually reduce.
    return fail(
      "timestamp_outside_tolerance",
      `The signed timestamp is ${age}s old, outside the ${toleranceSeconds}s tolerance.`,
    );
  }

  const expected = await hmacSha256Hex(secret, `${parsed.timestamp}.${payload}`);
  const matched = parsed.signatures.some((candidate) => equalsInConstantTime(candidate, expected));
  if (!matched) {
    return fail("no_matching_signature", "No signature in the header matches this payload and signing secret.");
  }

  return { ok: true };
}

interface ParsedSignatureHeader {
  timestamp: number;
  signatures: string[];
}

/**
 * Splits the header into its timestamp and every `v1` signature it offers.
 *
 * More than one `v1` is normal, not an attack: during a signing-secret rollover
 * Stripe signs each event with every active secret. Unknown schemes (`v0`, and
 * whatever Stripe adds next) are ignored rather than rejected.
 */
function parseSignatureHeader(header: string): ParsedSignatureHeader | null {
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;

    const scheme = part.slice(0, separator);
    const value = part.slice(separator + 1);

    if (scheme === "t" && /^\d+$/.test(value)) {
      timestamp = Number(value);
    } else if (scheme === "v1" && value) {
      signatures.push(value);
    }
  }

  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(message));

  return Array.from(new Uint8Array(mac))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Compares every character before answering, so the time taken does not reveal
 * how much of a forged signature was right — which is what would let an
 * attacker discover the rest of it one character at a time.
 *
 * The loop runs over `expected`, whose length is fixed by the digest, so its
 * shape never varies with attacker-supplied input. A length mismatch is folded
 * into the result rather than returned early, and a candidate shorter than
 * `expected` reads `NaN` past its end, which `| 0` turns into a value that
 * cannot accidentally match.
 *
 * This is as close as JavaScript gets: there is no `timingSafeEqual` here, and
 * no engine-level guarantee about string access.
 */
function equalsInConstantTime(candidate: string, expected: string): boolean {
  let difference = candidate.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) {
    difference |= expected.charCodeAt(i) ^ (candidate.charCodeAt(i) | 0);
  }
  return difference === 0;
}

function fail(reason: SignatureFailureReason, message: string): VerificationResult {
  return { ok: false, reason, message };
}

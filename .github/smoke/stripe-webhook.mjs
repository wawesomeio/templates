/**
 * Smoke test for the deployed stripe-webhook template.
 *
 * Runs against a Function that has just been deployed to the real platform by
 * the published CLI, and drives it exactly as Stripe would. This is what stands
 * between a commit and the stable tag: if a signed event does not come back 200,
 * or a forged one does, the tag does not move.
 *
 * Usage: node .github/smoke/stripe-webhook.mjs <invoke-url>
 */
import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const invokeUrl = process.argv[2];
if (!invokeUrl) {
  console.error("Usage: node .github/smoke/stripe-webhook.mjs <invoke-url>");
  process.exit(1);
}

// A secret minted per run, so the smoke test never depends on a stored one and
// nothing it signs is reusable afterwards.
const signingSecret = `whsec_${randomBytes(24).toString("hex")}`;

const event = {
  id: "evt_smoke_test",
  type: "payment_intent.succeeded",
  data: { object: { id: "pi_smoke", amount_received: 4200, currency: "eur" } },
};
const payload = JSON.stringify(event);

console.log("→ storing the signing secret on the App");
execFileSync("npx", ["--yes", "wawesome@latest", "env", "set", "STRIPE_WEBHOOK_SECRET", signingSecret, "--secret"], {
  cwd: "stripe-webhook",
  stdio: "inherit",
});

const now = () => Math.floor(Date.now() / 1000);

function signatureHeader(body, timestamp, secret = signingSecret) {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

async function post(body, header, method = "POST") {
  const response = await fetch(invokeUrl, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(header ? { "Stripe-Signature": header } : {}),
    },
    body: method === "POST" ? body : undefined,
  });
  return { status: response.status, body: await response.text() };
}

const failures = [];

async function expect(name, run, status, bodyIncludes) {
  const result = await run();
  const ok = result.status === status && result.body.includes(bodyIncludes);
  console.log(`${ok ? "✓" : "✗"} ${name} — ${result.status} ${result.body}`);
  if (!ok) failures.push(`${name}: expected ${status} containing "${bodyIncludes}", got ${result.status} ${result.body}`);
}

await expect(
  "a genuinely signed event is accepted",
  () => post(payload, signatureHeader(payload, now())),
  200,
  '"received":true',
);

await expect(
  "an unsigned request is rejected",
  () => post(payload, null),
  400,
  "Signature verification failed",
);

await expect(
  "a forged signature is rejected",
  () => post(payload, `t=${now()},v1=${"0".repeat(64)}`),
  400,
  "Signature verification failed",
);

await expect(
  "a signature from a different secret is rejected",
  () => post(payload, signatureHeader(payload, now(), "whsec_not_the_configured_secret")),
  400,
  "Signature verification failed",
);

await expect(
  "a payload edited after signing is rejected",
  async () => {
    const header = signatureHeader(payload, now());
    return post(payload.replace("4200", "9999999"), header);
  },
  400,
  "Signature verification failed",
);

await expect(
  "a captured request replayed later is rejected",
  () => {
    const stale = now() - 3600;
    return post(payload, signatureHeader(payload, stale));
  },
  400,
  "Signature verification failed",
);

await expect("a GET is refused", () => post(null, null, "GET"), 405, "POST from Stripe only");

if (failures.length > 0) {
  console.error(`\n✗ smoke test failed (${failures.length}):`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log("\n✓ stripe-webhook smoke test passed");

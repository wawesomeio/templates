# Stripe Webhook Receiver

A Stripe webhook endpoint you can deploy in about a minute, with signature
verification already written and tested.

Your webhook URL is public. Anyone who finds it can POST JSON at it, and a
forged `payment_intent.succeeded` is worth real money to whoever gets one past
you. Verifying Stripe's signature is what makes the difference — and it is the
part people most often copy from a blog post and get subtly wrong.

This template gets it right, and proves it: [`src/stripe-signature.ts`](src/stripe-signature.ts)
is short enough to read in full before you trust it, and
[`src/stripe-signature.test.ts`](src/stripe-signature.test.ts) covers replay,
tampering, secret rotation, malformed headers and truncated signatures.

## What it does

```
POST /  ──▶  verify Stripe-Signature  ──▶  200 {"received": true}
                       │
                       └── no match ──▶  400
```

- **Signature verification** — HMAC-SHA256 over `${timestamp}.${rawBody}`,
  compared in constant time against every signature Stripe offers.
- **Replay protection** — signed timestamps older than five minutes are refused.
- **Secret rotation** — Stripe signs with every active secret during a rollover;
  any one of them matching is enough.
- **Typed events** — `event.type` narrows `event.data.object` to the right Stripe
  type, so `session.customer_details.email` autocompletes and misspellings fail
  to compile.

## Quick start

```bash
npm install
npx wawesome login
npx wawesome deploy
```

`deploy` prints your endpoint's public URL. Paste it into
**Stripe Dashboard → Developers → Webhooks → Add endpoint**, copy the signing
secret it gives you back, and store it:

```bash
npx wawesome env set STRIPE_WEBHOOK_SECRET whsec_... --secret
```

Secrets are encrypted at rest and never readable back — not from the CLI, the
dashboard, or the API. They are decrypted only for the moment your function runs.

Then send a test event from the Stripe dashboard and watch it land:

```bash
npx wawesome logs --follow
```

## Configuration

| Variable | Required | Where to find it |
| --- | --- | --- |
| `STRIPE_WEBHOOK_SECRET` | yes | Dashboard → Developers → Webhooks → your endpoint → *Signing secret* → Reveal (`whsec_…`) |

Without it the endpoint answers `500` rather than accepting unverified requests —
an unconfigured webhook fails closed.

[`wawesome-function.json`](wawesome-function.json) names the App and Function this
deploys to. The App slug is part of your public URL, so rename it to your project
before the first deploy.

## Adding your own logic

`handleEvent` in [`src/index.ts`](src/index.ts) is where your code goes. Two things
worth knowing:

**Acknowledge quickly.** Stripe retries anything that is not a 2xx, so return the
response as soon as the event is safely recorded rather than after slow
downstream work.

**Deduplicate on `event.id`.** Stripe delivers at least once and does not
guarantee order, so the same event can arrive twice. Treat `event.id` as an
idempotency key and skip anything you have already applied.

## Why the Stripe SDK is imported `import type`

```ts
import type Stripe from "stripe";
```

You get Stripe's full type definitions — every event type, every object shape —
and the bundler erases the import at build time, so the SDK contributes **zero
bytes** to what gets deployed. The whole function is about 3 KB.

That is not only an optimisation. This runs on WebAssembly, and Stripe's Node SDK
assumes Node built-ins that do not exist here; its `constructEvent` reaches for
`node:crypto`. Verification is implemented directly on WebCrypto instead, which
the runtime does provide.

## Running the tests

```bash
npm test        # signature verification
npm run typecheck
```

The tests sign payloads the way Stripe does rather than calling the verifier's own
helpers, so they exercise the real scheme, not this implementation's idea of it.

## License

MIT

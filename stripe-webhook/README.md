# Stripe webhook receiver

A Stripe webhook endpoint. It checks the signature on every request with the Stripe SDK, then hands the event to a `switch`. Your code goes in that `switch`.

## Quick start

```bash
npm install
npx wawesome login
npx wawesome deploy
```

`deploy` prints your endpoint's address. Add it in **Stripe Dashboard → Developers → Webhooks → Add endpoint**. Stripe then shows the endpoint's signing secret. Store it:

```bash
npx wawesome env set STRIPE_WEBHOOK_SECRET whsec_... --secret
```

Send a test event from the Stripe dashboard and watch it arrive:

```bash
npx wawesome logs --follow
```

`npx wawesome init --template stripe-webhook` asks for the same secret. If you haven't created the endpoint yet, leave it blank and set it after the first deploy.

## The files

- [`wawesome-function.json`](wawesome-function.json) names the App and the Function. Both are part of your address.
- [`src/index.ts`](src/index.ts) is the handler. It checks the signature and passes the event to `handleEvent`.

## How it works

### The address

```
https://api.wawesome.io/x/<workspace>/stripe-webhook/stripe-events
```

The last two parts are the App and the Function from `wawesome-function.json`. Rename them before you give the address to Stripe. Once Stripe has it, a rename gives you an address Stripe can't reach.

The Function also answers every path below that address. Stripe posts to the address itself, so the handler sees `POST /`.

### The signature

Your code gets the request exactly as Stripe sent it, with every header, `Stripe-Signature` included, and the body byte for byte. Stripe signs those bytes. So the handler reads the body with `request.text()` and checks the signature before it parses anything:

```ts
event = await Stripe.webhooks.constructEventAsync(payload, signature, secret, undefined, cryptoProvider);
```

Your Function runs on WebAssembly, not Node, so there's no `node:crypto`. `Stripe.createSubtleCryptoProvider()` makes the SDK use `crypto.subtle`, which the runtime has. That's also why the check is the async one.

The SDK refuses a signature that doesn't match, a missing one, and one older than five minutes. The handler answers all three with `400`.

### The secret

The platform encrypts secrets at rest. Nobody can read one back, from the CLI, the dashboard or the API. Your Function sees it as `process.env.STRIPE_WEBHOOK_SECRET` while it runs.

If the secret isn't set, the endpoint answers `500` to every request and logs the command that fixes it.

### The bundle

The Stripe SDK is bundled whole, so `dist/index.js` is about 220 KB. `template.json` sets the size CI allows.

## Adding your own logic

Your code goes in `handleEvent` in [`src/index.ts`](src/index.ts).

- **Answer quickly.** Stripe retries anything that isn't a 2xx. Return once you've stored the event safely, not after slow work.
- **Skip duplicates.** Stripe can send the same event twice, and in any order. Store `event.id` and skip an event you've already handled.
- **Unknown types are logged and acknowledged.** Stripe sends every type the endpoint subscribes to, including types it adds later.

## Tests

```bash
npm test
npm run typecheck
```

The tests call the handler with a `Request` and read the `Response`. They sign each body with `Stripe.webhooks.generateTestHeaderStringAsync`, the helper Stripe ships for this. Keep them as a pattern for your own, or delete them.

## License

MIT

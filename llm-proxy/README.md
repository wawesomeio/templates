# LLM Proxy

A server-side proxy between your frontend and any OpenAI-compatible model.

The model call is one `fetch`. That is not what this is for. It is for the three
things a frontend cannot do for itself:

- **The API key never reaches the browser.** It lives in this Function's
  environment, stored write-only. It is not in your bundle, not in a network
  response, and not recoverable from devtools.
- **The system prompt never reaches the browser either.** It is compiled into
  the deployed code, and no field of the public API can replace it — a client
  that sends a `system` message is refused rather than sanitised.
- **Every request has a ceiling before it costs anything.** Who may call, how
  much history they may send, how long the answer may be. All decided here, with
  no network involved.

The client's half of the contract is deliberately tiny:

```http
POST /
Content-Type: application/json

{ "messages": [{ "role": "user", "content": "Where is my order?" }] }
```

```json
{ "reply": "..." }
```

`model`, `temperature` and the output ceiling are not fields. A request carrying
any of them is refused — that is the difference between a proxy and an open
relay to your billing account.

## Deploy it

```bash
npx wawesome init --template llm-proxy
```

It asks for your API key and the origins allowed to call the endpoint, stores
them, enables outbound calls to OpenAI for the App, deploys, and prints the URL.

Or clone and deploy by hand:

```bash
git clone https://github.com/wawesomeio/templates
cd templates/llm-proxy
npm install
npx wawesome login
npx wawesome env set OPENAI_API_KEY sk-... --secret
npx wawesome deploy
```

## What it costs, per request

Watch it as it happens:

```bash
npx wawesome logs --follow
```

Every request writes one line:

```
usage model=gpt-4o-mini prompt_tokens=412 completion_tokens=118 total_tokens=530 ms=1843
```

A proxy that hides the key also hides the bill — the frontend no longer sees
what it spent, and neither does anyone reading the network tab. This is where
that visibility comes back.

Set two rates and the line carries money as well as tokens:

```bash
npx wawesome env set USD_PER_MILLION_INPUT_TOKENS 0.15
npx wawesome env set USD_PER_MILLION_OUTPUT_TOKENS 0.60
```

```
usage model=gpt-4o-mini prompt_tokens=412 completion_tokens=118 total_tokens=530 ms=1843 cost_usd=0.000133
```

Both or neither: a half-configured pair would produce a confidently wrong
number. The rates are configuration rather than constants in the source because
model prices change, and a hard-coded price silently becomes a lie.

## The ceilings

They are constants at the top of `src/policy.ts`. They are yours — the right
numbers depend on what your assistant is for.

| Limit | Default | What it stops |
| --- | --- | --- |
| `maxBodyChars` | 24,000 | Parsing megabytes of JSON before refusing it |
| `maxMessages` | 12 | A client replaying a thousand-turn history at you |
| `maxPromptChars` | 8,000 | The text that actually costs money |
| `maxOutputTokens` | 512 | An answer that bills for as long as it likes |

With them, the most expensive request anyone can send is bounded and
calculable, whatever they put in the body.

### What the origin list is, and is not

`ALLOWED_ORIGINS` stops **another website** from spending your budget out of a
visitor's tab. That is a real and common way an unprotected proxy gets drained,
and the browser enforces it for you.

It is **not** a defence against someone running `curl`: `Origin` is a header, and
a header is whatever the caller says it is. If you need to stop that, the answer
is authentication — check a session your app already issues, in the same place
the origin is checked.

Leaving it unset answers any origin, so a first deploy works before you have
decided anything. The Function logs a warning on every request while it is unset.

There is deliberately **no cross-request rate limit** in this template. A limiter
worth having counts requests across invocations, and that needs shared state the
runtime does not have yet; a counter in module scope would reset on essentially
every request and advertise protection it does not provide. What is here instead
is a hard ceiling on each individual request, which needs no state to be true.

## Making it yours

**The prompt.** `src/system-prompt.ts` ships a placeholder persona — a support
assistant for an online store. Replace all of it. A prompt you have iterated on
against real users is worth real money, which is the entire reason this template
keeps it server-side.

Changing it is a deploy. Shipping a bad one is a rollback: promote the previous
version and the old prompt is live again, with no redeploy and no git revert.

**The model.** Set without redeploying:

```bash
npx wawesome env set OPENAI_MODEL gpt-4o
```

Reasoning models reject `temperature` — drop it from the request body in
`src/index.ts` if you switch to one.

**A different provider.** Any OpenAI-compatible endpoint:

```bash
npx wawesome env set OPENAI_BASE_URL https://your-provider.example/v1
```

Outbound access is default-deny per App. Scaffolding enables the `openai`
provider, which authorises `api.openai.com` and nothing else — pointing at
another host means adding it to the App's outbound allowlist first, or the call
comes back as "could not be reached".

## What is in here

```
llm-proxy/
├── src/index.ts           the endpoint: gate, validate, call, log
├── src/policy.ts          who may call and what it may cost — no network, all tested
├── src/system-prompt.ts   the prompt that never leaves the server
├── src/usage.ts           the per-request cost line
└── template.json          what this template needs before it can run
```

`policy.ts` and `usage.ts` are pure and have no dependencies, which is why the
tests cover every refusal path without a single mock. Run them:

```bash
npm test
npm run typecheck
```

The OpenAI package is a **type-only** import — full autocomplete on the request
and response shapes, and the bundler erases it, so nothing of it reaches the
deployed WebAssembly. CI asserts that by failing if the bundle grows.

## Environment variables

| Name | Required | Secret | What it is |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | yes | yes | The key the proxy calls with. Never readable back, never sent to a client |
| `ALLOWED_ORIGINS` | no | no | Comma-separated origins allowed to call the endpoint. Unset answers anything |
| `OPENAI_MODEL` | no | no | Defaults to `gpt-4o-mini` |
| `OPENAI_BASE_URL` | no | no | Defaults to `https://api.openai.com/v1` |
| `USD_PER_MILLION_INPUT_TOKENS` | no | no | Turns the usage line into a cost line, with the one below |
| `USD_PER_MILLION_OUTPUT_TOKENS` | no | no | As above — both or neither |

Only the first two are asked for during `init`. The rest have working defaults
and are set with `wawesome env set` when you want them.

## Responses

| Status | When |
| --- | --- |
| `200` | `{ "reply": "..." }` |
| `400` | Malformed body, a bad message, or a field other than `messages` |
| `403` | Origin not allowed, or a client-supplied system prompt |
| `405` | Anything other than `POST` (and the `OPTIONS` preflight) |
| `413` | Body, conversation or prompt over a ceiling |
| `429` | The provider is rate-limiting — back off and retry |
| `500` | `OPENAI_API_KEY` is not set |
| `502` | The provider could not be reached, or refused, or answered unusably |

No refusal ever quotes what the client sent, and no response ever carries the
key, the prompt, or the provider's own error text.

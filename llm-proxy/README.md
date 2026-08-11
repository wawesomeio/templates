# LLM Proxy

A server-side proxy between your frontend and any OpenAI-compatible model, which
streams the answer to the page a word at a time.

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

```http
200 OK
Content-Type: text/event-stream

event: delta
data: {"text":"Your order "}

event: delta
data: {"text":"shipped on Tuesday."}

event: done
data: {"finish_reason":"stop"}
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

## The address your frontend calls

```
https://api.wawesome.io/x/<workspace>/llm-proxy/chat
                        │      │           │      │
                        │      │           │      └─ Function slug
                        │      │           └─ App slug
                        │      └─ your workspace slug
                        └─ reserved for invocation, never a management route
```

`deploy` prints it. The App and Function slugs come from
[`wawesome-function.json`](wawesome-function.json), so renaming either renames
the address — worth doing before the URL is baked into a frontend build.

From a page, sending the request is one `fetch`; [reading the
answer](#the-answer-arrives-as-it-is-written) is the next section.

```js
const response = await fetch('https://api.wawesome.io/x/acme/llm-proxy/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Where is my order?' }] }),
});
```

Cross-origin, the browser makes that two requests: an `OPTIONS` preflight first,
then the `POST`. The preflight reaches this Function like anything else and
`src/index.ts` answers it — there is no platform layer in front deciding CORS on
your behalf. The `Origin` header arrives exactly as the browser sent it, which is
what `ALLOWED_ORIGINS` is compared against.

The address is a mount rather than a single route: every path beneath it reaches
this Function too, which sees the path with the mount stripped off. A frontend
posts to the address itself, so the handler runs for a request it sees as
`POST /`.

## The answer arrives as it is written

The response is `text/event-stream`, and it carries three kinds of event.

| Event | Payload | What it means |
| --- | --- | --- |
| `delta` | `{ "text": "..." }` | A piece of the answer. Zero or more of them, in order — append them as they arrive |
| `done` | `{ "finish_reason": "stop" }` | The answer is whole. Always last. `"length"` instead of `"stop"` means `maxOutputTokens` cut it off mid-sentence |
| `error` | `{ "error": "..." }` | The answer broke after it had started. Always last, and never alongside a `done` |

A stream that ends with **neither** `done` nor `error` did not finish: the
connection dropped, or the platform ended the invocation before the Function
could say anything. That is why `done` exists at all — a truncated body and a
complete one are otherwise indistinguishable to a browser, and an assistant that
silently stops mid-sentence is worse than one that admits it.

`EventSource` cannot send a `POST` or a request body, so reading this is `fetch`
plus a reader. That is twenty lines, all of them here:

```js
if (!response.ok) throw new Error((await response.json()).error);

const bubble = document.querySelector('#answer');
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
let complete = false;

for (;;) {
  const { value, done } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  const frames = buffer.split('\n\n');
  buffer = frames.pop();

  for (const frame of frames) {
    const name = frame.match(/^event: (.*)$/m)?.[1];
    const data = JSON.parse(frame.match(/^data: (.*)$/m)[1]);

    if (name === 'delta') bubble.textContent += data.text;
    if (name === 'done') complete = true;
    if (name === 'error') throw new Error(data.error);
  }
}

if (!complete) throw new Error('The answer stopped before it finished.');
```

The `response.ok` check on the first line is the whole of the error handling for
anything that fails **before** the answer starts — a refused origin, a body over
a ceiling, a provider that rejects the request or cannot be reached. All of those
are answered as `application/json` with one `error` string, exactly as they were
before this endpoint streamed anything, because a status is still available to
carry them. Once the first byte of the stream is out the status is spent, and the
`error` event is what is left.

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
that visibility comes back, and nowhere else: no event on the stream carries a
token count or a price, because hiding the bill from the browser is the point
rather than an oversight.

Streaming makes that line harder to produce than it looks. There is no complete
response to read the token counts off, and a provider streaming a completion
reports usage in a single final event — only to a request that asked for it. So
the request asks (`stream_options: { include_usage: true }`), and the one pass
over the provider's stream feeds both directions at once: the text goes to the
browser as it arrives, and the counts riding on that last event go to the log. A
provider that ignores the opt-in gets `tokens=unreported`, never zero — a gap in
the log is honest, and a free-looking request is not.

An answer that broke, and one whose caller closed the tab, both still write the
line — so an interrupted request shows what it spent before it stopped. The one
case with no line is the platform ending the invocation mid-answer: nothing in
the Function runs after that.

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

What each answer looks like from the page is deliberate, and worth knowing when
you are debugging one. An origin **on** the list gets CORS headers on every
response it receives, refusals included — without them a browser cannot read the
status or the body, and a `413` you cannot see is indistinguishable from the
endpoint being down. An origin **not** on the list gets no allow-origin header at
all, so the call fails in the browser as a CORS error rather than as a readable
`403`. Handing it the header would be granting the access the refusal just
denied.

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
├── src/index.ts           the endpoint: gate, validate, call, stream, log
├── src/policy.ts          who may call and what it may cost — no network, all tested
├── src/sse.ts             the event-stream format, read from the provider and written to the page
├── src/system-prompt.ts   the prompt that never leaves the server
├── src/usage.ts           the per-request cost line
└── template.json          what this template needs before it can run
```

`policy.ts`, `sse.ts` and `usage.ts` are pure and have no dependencies, which is
why the tests cover every refusal path without a single mock.
[`src/index.test.ts`](src/index.test.ts) drives the endpoint itself the way a
browser does — the preflight, an admitted origin, a refused one, the CORS headers
on every answer each of them gets, and a provider whose stream this test writes
by hand so it can check that a delta reaches the caller while the model is still
generating. Run them:

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
| `200` | `text/event-stream` — the answer, as `delta` events, ending in `done` or `error` |
| `400` | Malformed body, a bad message, or a field other than `messages` |
| `403` | Origin not allowed, or a client-supplied system prompt |
| `405` | Anything other than `POST` (and the `OPTIONS` preflight) |
| `413` | Body, conversation or prompt over a ceiling |
| `429` | The provider is rate-limiting — back off and retry |
| `500` | `OPENAI_API_KEY` is not set |
| `502` | The provider could not be reached, or refused, or answered with no body at all |

Everything but the first row is `application/json`, one `error` string, and a
status the browser can branch on. Every one of them is decided before a byte of
the answer has gone out, which is what makes the status available to carry them
— a provider that gives up halfway through generating cannot be reported this
way, and arrives as an `error` event instead.

No refusal ever quotes what the client sent, and no response ever carries the
key, the prompt, or the provider's own error text.

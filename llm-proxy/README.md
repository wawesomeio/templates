# LLM Proxy

A proxy between your page and any OpenAI-compatible model. It is built with [Hono](https://hono.dev), [zod](https://zod.dev) and the [`openai`](https://github.com/openai/openai-node) SDK, and it streams the answer to the page as the model writes it.

It does three things a page cannot do for itself:

- **It keeps the API key on the server.** The key is stored write-only in the Function's environment. It is not in your bundle and never appears in a response.
- **It keeps the system prompt on the server.** The prompt is compiled into the deployed code. A client that sends a `system` message is refused.
- **It limits every request before it costs anything.** Who may call, how much history they may send and how long the answer may be are all checked before the model is called.

## Quick start

```bash
npx wawesome init --template llm-proxy
```

It asks for your API key and the origins allowed to call the endpoint, allows outbound calls to OpenAI for the App, deploys, and prints the URL.

Or by hand:

```bash
npm install
npx wawesome login
npx wawesome env set OPENAI_API_KEY sk-... --secret
npx wawesome deploy
```

## Calling it

The client sends the conversation and nothing else:

```js
const response = await fetch('https://api.wawesome.io/x/<workspace>/llm-proxy/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Where is my order?' }] }),
});
```

`model`, `temperature` and the output limit are not fields. A request that carries one is refused, so nobody can use your key to call a more expensive model.

The answer is `text/event-stream`:

```
event: delta
data: {"text":"Your order "}

event: delta
data: {"text":"shipped on Tuesday."}

event: done
data: {"finish_reason":"stop"}
```

| Event | Data | Meaning |
| --- | --- | --- |
| `delta` | `{ "text": "..." }` | The next piece of the answer. Append it. |
| `done` | `{ "finish_reason": "stop" }` | The answer is complete. `"length"` means the output limit cut it off. |
| `error` | `{ "error": "..." }` | The answer broke after it started. |

`done` and `error` always come last, and never both. A stream that ends with neither was cut off: the connection dropped, or the platform ended the invocation.

`EventSource` cannot send a POST body, so read the stream with `fetch`:

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

Every failure before the answer starts is a JSON body with one `error` string and a status, so the `response.ok` check on the first line handles all of them. After the first byte the status is sent, and the `error` event is the only way left to report a failure.

## How the platform runs it

**The address is a mount.** The Function answers at `https://api.wawesome.io/x/<workspace>/llm-proxy/chat`. The platform strips that prefix, so a call to the address arrives as `POST /`, and `src/index.ts` declares its route as `/`. Any other path beneath the address also reaches the Function, which answers it with a 404. The App and Function names come from [`wawesome-function.json`](wawesome-function.json). Rename them before the URL goes into a frontend build.

**CORS is the Function's job.** No platform layer answers the browser's `OPTIONS` preflight. Hono's `cors` middleware does. The `Origin` header arrives as the browser sent it.

**Outbound calls are closed by default.** A Function can only call hosts its App allows. `init` allows `api.openai.com` and nothing else.

**There are only `fetch` and streams.** The `openai` SDK makes its call with `fetch` and reads the answer as a stream, and both work in the Function. The SDK is most of the bundle, about 350 KB of 480 KB.

**Logs are live.** Whatever the Function writes with `console.log` appears in `npx wawesome logs --follow`.

## What each request costs

Every request writes one line to the log:

```
usage model=gpt-4o-mini prompt_tokens=412 completion_tokens=118 total_tokens=530 ms=1843
```

The browser never sees token counts. This line is where you see them. The request asks the provider for usage (`stream_options: { include_usage: true }`), because a streamed answer only reports it when asked. A provider that does not report it logs `tokens=unreported`, not zero. An answer that broke, or whose caller closed the tab, still writes the line.

Set two prices and the line shows dollars too:

```bash
npx wawesome env set USD_PER_MILLION_INPUT_TOKENS 0.15
npx wawesome env set USD_PER_MILLION_OUTPUT_TOKENS 0.60
```

```
usage model=gpt-4o-mini prompt_tokens=412 completion_tokens=118 total_tokens=530 ms=1843 cost_usd=0.000133
```

Set both or neither. With only one, there is no cost.

## The limits

They are the `LIMITS` constant at the top of `src/policy.ts`. Change them to fit what your assistant is for.

| Limit | Default | What it stops |
| --- | --- | --- |
| `maxBodyBytes` | 24,000 | Reading megabytes of JSON before refusing it |
| `maxMessages` | 12 | A client sending a thousand-turn history |
| `maxPromptChars` | 8,000 | Too much text, which is what you pay for |
| `maxOutputTokens` | 512 | An answer that runs as long as it likes |

With these, the most expensive request anyone can send has a known price.

### The origin list

`ALLOWED_ORIGINS` stops another website from spending your budget from a visitor's browser. The browser enforces it.

It does not stop someone using `curl`. `Origin` is a header, and a caller can set it to anything. To stop that, check a session your app already issues, in the same middleware that checks the origin.

When it is not set, any origin may call, so a first deploy works. The Function logs a warning on every request until you set it.

An origin on the list gets CORS headers on every answer, refusals included, so the page can read the status and the error. An origin not on the list gets a 403 with no CORS headers, so the browser reports a CORS error.

There is no rate limit across requests. A useful one needs to count requests between invocations, and the Function keeps nothing between requests. What it has instead is a limit on each request.

## Making it yours

**The prompt.** `src/system-prompt.ts` is a placeholder support assistant for an online store. Replace all of it. Changing it is a deploy, and a bad prompt is a rollback to the previous version, with no redeploy.

**The model.** Set it without a redeploy:

```bash
npx wawesome env set OPENAI_MODEL gpt-4o
```

Reasoning models reject `temperature`. Remove it from the call in `src/index.ts` if you switch to one.

**Another provider.** Any OpenAI-compatible API works:

```bash
npx wawesome env set OPENAI_BASE_URL https://your-provider.example/v1
```

Add that provider's host to the App's outbound allowlist first. Until you do, requests fail with "The model provider could not be reached."

## Environment variables

| Name | Required | Secret | What it is |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | yes | yes | The key the proxy calls the provider with |
| `ALLOWED_ORIGINS` | no | no | Comma-separated origins allowed to call. Unset allows any |
| `OPENAI_MODEL` | no | no | Defaults to `gpt-4o-mini` |
| `OPENAI_BASE_URL` | no | no | Defaults to `https://api.openai.com/v1` |
| `USD_PER_MILLION_INPUT_TOKENS` | no | no | Adds a cost to the usage line, with the one below |
| `USD_PER_MILLION_OUTPUT_TOKENS` | no | no | See above. Set both or neither |

`init` asks for the first two. The rest have defaults.

## Responses

| Status | When |
| --- | --- |
| `200` | The answer, as `text/event-stream` |
| `400` | The body is not JSON, a message is wrong, or it has a field other than `messages` |
| `403` | The origin is not allowed, or the client sent a system prompt |
| `404` | A path other than the address itself |
| `405` | A method other than `POST` or the `OPTIONS` preflight |
| `413` | The body, the history or the text is over a limit |
| `429` | The provider is rate limiting. Wait and retry |
| `500` | `OPENAI_API_KEY` is not set. The response does not say which setting is missing |
| `502` | The provider could not be reached, or refused the request |

Every status but `200` has a JSON body with one `error` string. No response repeats what the client sent, and none carries the key, the prompt or the provider's own error text.

## Tests

```bash
npm test
npm run typecheck
```

The tests call the exported `fetch` handler with a `Request` and read the `Response`. The call to the provider goes through a stubbed `fetch`, so nothing reaches the network.

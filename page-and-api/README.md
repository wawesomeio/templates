# Page + API

A landing page and the endpoint the form on it posts to, in one deploy.

The pages are files. `public/index.html` and `public/404.html` are uploaded with
the code and served by the platform straight from storage. `src/index.js` is a
handler in the same Version, and it answers the form's `POST` with a price. One
hostname, one deploy, one thing to roll back — and no CORS, because there is no
second origin to reach across.

The site is a small letterpress studio that does not exist. The copy is there so
the page looks like something before you have written a word.

## Quick start

```bash
npm install
npx wawesome login
npx wawesome deploy
```

The deploy prints the address. Open it, ask for a price, and both halves of the
template have just run.

## How the two halves divide the address space

```
public/index.html    →  /            served by the platform, no code runs
public/404.html      →  /404.html    likewise
src/index.js         →  everything else, plus every non-GET
```

On your App's own hostname the platform serves a page whose address matches a
file it carries. Your handler is never invoked for one, nothing is billed as an
invocation, and no cold start sits between the visitor and the markup.

Everything else reaches the handler: the form's `POST`, and any address no page
claims. That is the half a static host does not have.

## The page posts to itself

The form sends its order to `location.pathname` — the address the page was
loaded at:

```js
const response = await fetch(location.pathname, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ quantity: 250, colours: 2, rush: false }),
});
```

A `POST` to a page's address reaches the handler rather than the file, so there
is no endpoint URL to configure, nothing to change when you attach a domain, and
no preflight. Drive it from anywhere:

```bash
curl -X POST https://<your-address> \
  -H 'Content-Type: application/json' \
  -d '{"quantity":250,"colours":2,"rush":true}'
```

The answer names each line and a total in pence, so nothing has to be parsed
back out of formatted money:

```json
{
  "currency": "GBP",
  "quantity": 250,
  "colours": 2,
  "rush": true,
  "lines": [
    { "label": "Plates and make-ready, 2 colours", "pence": 9000 },
    { "label": "250 cards at 34p", "pence": 8500 },
    { "label": "Rush, in 5 working days", "pence": 4375 }
  ],
  "total_pence": 21875,
  "lead_time_days": 5
}
```

An order the studio cannot print comes back `400` naming the field. A body that
is not JSON is `400`, a body sent as something else is `415`, and a method
neither half answers is `405` with `Allow`.

## Why the price is not in the page

`src/pricing.js` holds the rates, and the markup does not know a single one of
them. Change a rate, deploy, and the next visitor is quoted the new figure —
there is nothing cached in a browser that could quote the old one, and no build
to rerun. That is the whole reason this endpoint exists rather than a few lines
of JavaScript in the page.

## Answering with a page from inside the handler

When the handler does have to answer with a page, it names one instead of
rendering it:

```js
return new Response(null, { status: 404, headers: { "x-wawesome-document": "404.html" } });
```

The platform streams that file in place of the body, at the status the handler
chose. So the not-found page is the same file at `/404.html` and at every
address nobody deployed anything for, and there is one copy of it.

`src/index.js` keeps a short map of the pages this deploy carries. On your App's
hostname nothing reads it — the platform has already served those addresses. It
is for the development path form (`/x/<workspace>/<app>/<function>/…`), where
every request reaches your handler because a file served on an origin every
workspace shares would be same-origin with all of them. Naming the page back
there is what makes the two surfaces behave alike.

## Editing it

- **The words**: `public/index.html`, as HTML. No build step, no bundler.
- **The prices**: `prices` at the top of `src/pricing.js`.
- **A second page**: drop `public/pricing.html` in and add it to the `pages` map
  in `src/index.js`. It answers at `/pricing.html` on your hostname either way;
  the map is what makes the development path form agree.
- **The attribution**: the "Built with wawesome" line in the footer is yours to
  delete. The platform injects nothing, so nothing puts it back.

## Tests

```bash
npm test        # vitest, against the JavaScript your Function actually gets
npm run typecheck
```

The suite drives the handler the way the platform does — a `Request` in, a
`Response` out — and holds both claims this template makes: that a page address
is answered by naming a file rather than writing markup, and that the form's
address and the page's address are the same one.

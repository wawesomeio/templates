# Landing Page

A one-page website for a small business — headline, three sections, contact
details — returned by a single Function.

One file. No build step, no bundler, no files uploaded alongside it. What you
read in `src/index.js` is exactly what a visitor's browser receives.

## Quick start

```bash
npm install
npx wawesome login
npx wawesome deploy
```

The deploy prints the address. Open it and you have a page you can send to
somebody.

## Why this page is one file

A page here does not have to be a Function. A deploy can carry `index.html` as a
file beside the code and the platform serves it straight from storage, which is
what [`page-and-api`](https://github.com/wawesomeio/templates/tree/main/page-and-api)
does. If you would rather write your site as HTML, start there instead.

This template returns the markup from a handler because that leaves it with
nothing else to carry. No build output to hash, no file to declare in the
deploy, no `dist/` to keep in step with a source tree. The whole site is one
JavaScript module whose `fetch` handler returns a string. It is small enough to
paste, which means an agent holding no terminal can deploy it as easily as you
can.

The same reasoning covers what the page references. A stylesheet or an image
would be one more file to declare and keep in step, so the styles are inline in
the markup instead. If you want client-side behaviour, reach for a module the
visitor's browser loads from a CDN rather than for a bundler you do not have.

## Changing the words

They are all in one place — the `site` object at the top of
[`src/index.js`](src/index.js):

```js
const site = {
  name: "Fernwood Ceramics",
  tagline: "Hand-thrown stoneware, made to be used every day",
  ...
};
```

Change them, run `npx wawesome deploy`, refresh. The studio in the shipped copy
does not exist; it is there so the page looks like something before you have
written a word.

Add or remove a card by editing the `sections` array. Every value goes through
`escapeHtml`, so a business called "Fern & Co" gets a page rather than broken
markup.

## The attribution line

The footer carries this:

```html
<p class="attribution"><a href="https://wawesome.io">Built with wawesome</a></p>
```

Delete the line and it is gone. The platform injects nothing into what your
Function returns, so nothing puts it back.

## What answers where

The Function owns every path beneath its address, and this one serves the same
page at all of them — a visitor who types a trailing segment gets the site
rather than a 404. `GET` and `HEAD` are answered; anything else comes back
`405` with an `Allow` header.

## Tests

```bash
npm test        # vitest, against the JavaScript your Function actually gets
npm run typecheck
```

The suite drives the handler the way the platform does: a `Request` in, a
`Response` out. It holds the two claims this template makes — that the response
carries no reference to a file, and that the attribution is a single line.

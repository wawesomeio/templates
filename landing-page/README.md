# Landing Page

A one-page website for a small business, returned by a single Function: a
headline, three sections and contact details.

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
file beside the code, and the platform serves it from storage.
If you would rather write your site as HTML,
[Documents](https://wawesome.io/docs/documents) shows how.

This template returns the markup from a handler, so it has nothing else to carry:
no build output, no file to declare in the deploy, no `dist/` to keep in step. The
whole site is one JavaScript module with no imports, and there is no compile
step. It is small enough to paste, so an
agent with no terminal can deploy it as easily as you can.

The styles are inline for the same reason. A stylesheet or an image would be one
more file to declare. If you want client-side behaviour, load a module from a CDN
in a `<script type="module">` rather than adding a bundler.

## Changing the words

They are all in one place, the `site` object at the top of
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
page at all of them. A visitor who types a trailing segment gets the site
rather than a 404. `GET` and `HEAD` are answered; anything else comes back
`405` with an `Allow` header.

## Tests

```bash
npm test
npm run typecheck
```

The tests call the handler the way the platform does: a `Request` in, a
`Response` out. Keep them as a pattern for your own, or delete them.

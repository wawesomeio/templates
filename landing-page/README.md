# Landing page

A one-page website for a small business: a headline, three sections and contact details. One Function returns the whole page.

It's one file. There's no build step, no bundler and nothing uploaded beside it. What you read in `src/index.js` is exactly what a visitor's browser gets.

## Quick start

```bash
npm install
npx wawesome login
npx wawesome deploy
```

The deploy prints the address. Open it, and you have a page you can send to someone.

## Why the page is one file

A page doesn't have to be a Function. A deploy can carry `index.html` as a file beside the code, and the platform serves it from storage. If you'd rather write your site as HTML, [Documents](https://wawesome.io/docs/documents) shows how.

We return the markup from a handler instead, so there's nothing else to carry. You have no build output, no file to declare in the deploy and no `dist/` to keep in step. The whole site is one JavaScript module with no imports and no compile step. It's small enough to paste, so an agent with no terminal can deploy it as easily as you can.

The styles are inline for the same reason. A stylesheet or an image would be one more file to declare. If you want the page to do something in the browser, load a module from a CDN in a `<script type="module">`. You don't need a bundler for that.

## Changing the words

They're all in one place, the `site` object at the top of [`src/index.js`](src/index.js):

```js
const site = {
  name: "Fernwood Ceramics",
  tagline: "Hand-thrown stoneware, made to be used every day",
  ...
};
```

Change them, run `npx wawesome deploy` and refresh. The studio in the page doesn't exist. It's there so the page looks like something before you've written a word.

To add or remove a card, edit the `sections` array. Every value goes through `escapeHtml`, so a business called "Fern & Co" gets a page and not broken markup.

## The attribution line

The footer has this line:

```html
<p class="attribution"><a href="https://wawesome.io">Built with wawesome</a></p>
```

Delete it and it's gone. The platform adds nothing to what your Function returns, so nothing puts it back.

## What answers where

The Function owns every path below its address, and it serves the same page at all of them. A visitor who types an extra segment gets the site, not a 404. It answers `GET` and `HEAD`. Any other method gets a `405` with an `Allow` header.

## Tests

```bash
npm test
npm run typecheck
```

The tests call the handler the way the platform does, with a `Request` in and a `Response` out. Keep them as a pattern for your own, or delete them.

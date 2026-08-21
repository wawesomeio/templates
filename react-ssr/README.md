# React, server-rendered

A React application that renders on the server and streams to the browser, running
as a single Function on [wawesome.io](https://wawesome.io). One command deploys the
whole thing — the server bundle and the client build go up together, at one version,
and roll back together.

```bash
npm install
npx wawesome login
npx wawesome deploy
```

Open the address it prints and read the page source. The markup is already there,
before any script has run.

## What is here

```
index.html               the document — inlined into the server bundle, never uploaded
src/entry.server.tsx     the handler the platform calls; the only file that knows about HTTP
src/entry.client.tsx     hydration
src/App.tsx              the page
src/Activity.tsx         a section behind a Suspense boundary, so it does not block the shell
src/mount.ts             where every URL in the document comes from
vite.config.ts           two builds, one command
```

## Working on it

```bash
npm run dev
```

Hot module replacement, with the application driven through the same
`entry.server.tsx` the platform calls — so what you see locally is the rendering
path, not a client-only approximation of it.

The dev server also takes away the JavaScript the guest does not have. `Intl` is
not defined in your own modules, and `toLocaleString` and its relatives throw
rather than quietly ignoring the locale. Node has all of them; the guest has none.
Without this, an app formatting a price renders `1,234.50` locally and `1234.5` in
production — a hydration mismatch that local development cannot reproduce.

Format values yourself, or bundle a formatting library and call it directly. If you
add an `Intl` polyfill to `package.json`, the dev server stops taking `Intl` away
and the build stops objecting to it.

## Addresses

Your Function answers at several addresses at once: its App's hostname, any older
slug a rename left resolving, a preview URL for a version you have not promoted,
and the path form where a deployment enables it. Every one of them is a different
prefix in front of the same application.

So no URL in this project is decided at build time. The platform strips the prefix
on the way in and hands it back on `x-wawesome-forwarded-prefix`, `src/mount.ts`
reads it, and the document is built from it — the stylesheet, the client bundle,
the images, and the same string handed to the browser so hydration resolves
against exactly what the server rendered against.

Relative URLs would not do instead: they resolve against the document's own path,
and a page with client-side routing is served at whatever depth the router asks
for. Nor would a `<base>` element, which captures every relative URL on the page,
including your own links and form actions.

## The two builds

`npm run build` runs Vite twice and then bundles the result for the platform:

- **client** → `dist/client`, uploaded as static files. Served straight from
  object storage under `/assets/`, cached immutably, never reaching the runtime.
- **server** → `dist/server`, bundled into `dist/index.js` and deployed as the
  Function.

`index.html` belongs to neither. It is inlined into the server bundle, because a
document served statically at the mount root would shadow the route that renders
the page — every visitor would get an empty shell and a hydration mismatch, with
nothing in the logs to say why. The platform refuses to upload one at all.

## What a render costs

A single invocation has fuel for roughly **165 KB of rendered HTML**. Past that
the invocation ends as a `fuel-exhausted` 502 with nothing rendered — so paginate
long lists rather than streaming a whole table into one document. Memory is not
the constraint: a render at that ceiling uses about 12 MB of the 32 available.

The page here renders in about 3 KB.

## When rendering fails

`src/entry.server.tsx` catches nothing, on purpose.

A component that throws while the **shell** is rendering rejects before any of
the response has been committed. The caller gets a whole, framed 500 rather than
a body cut off part-way, the run is recorded against this Function rather than
the platform, and the stack is in `wawesome logs` under the invocation id on that
same response — so a failure is diagnosable from the response the caller was
handed.

A boundary that fails *after* the shell is committed is React's to recover from
in the browser, and reaches the platform as an ordinary successful run.

If you want a designed error page rather than an empty 500, put an error boundary
in the component tree, where it has something to say. Wrapping the handler in a
`try`/`catch` produces the same 500 with less in the logs.

## Deploying

```bash
npx wawesome deploy
```

The client build's files go up first — only the ones the platform does not already
hold, so changing one component re-uploads one chunk — and then the server bundle,
declaring the set it was built against. The version and the files it references are
written together or not at all.

## License

MIT.

# React, server-rendered

A [React Router](https://reactrouter.com) v7 app in framework mode. One Function on [wawesome.io](https://wawesome.io) renders it on the server. The server bundle and the client build deploy together, run at one version and roll back together.

It only answers at the App's own hostname. It doesn't answer under a preview URL or the path form.

## Quick start

```bash
npm install
npx wawesome login
npx wawesome deploy
```

Open the address it prints and read the page source. The list of books is already in the HTML, before any script has run.

## What's here

```
app/root.tsx              the document and the error page
app/routes.ts             the route table
app/routes/home.tsx       the list: a loader, and a form with an action
app/routes/book.tsx       one book: a loader that answers 404 for an unknown id
app/books.ts              the data, as a fixed list
app/entry.server.tsx      renders to a web stream
server.ts                 the Function: React Router's request handler as `fetch`
```

The form doesn't save anything. Its action checks the title and redirects to `/?suggested=...`, so a reload doesn't post again. A Function keeps nothing in memory from one request to the next. To store suggestions, write them to a database you reach over `fetch`, such as a Supabase table.

## Working on it

```bash
npm run dev
```

This is React Router's own dev server, with hot reloading.

`npm run build` runs `react-router build`, then bundles `build/server/index.js` into `dist/index.js`. `wawesome deploy` uploads `dist/index.js` as the Function and `build/client` as static files. The platform serves the files under `/assets/` from storage, so they never reach your code.

## Tests

```bash
npm test
```

The one test requests `/` from the Function's `fetch` and checks that the loader's data is in the page.

## The platform

A Function isn't Node. `vite.config.ts` bundles every dependency into the server build, and picks each package's `worker` or `browser` build, so nothing imports Node. Keep the build a production one. A development build is about 2.5 times larger, and it may not fit in a Function's 32 MB of memory.

The engine has no `Intl`, and `toLocaleString` ignores the locale. A price that renders `1,234.50` on your machine renders `1234.5` in production, and you see it as a hydration mismatch. `npm run build` warns about each use, with its file and line, and `npm test` fails on them. Format the value yourself, or bundle a formatting library.

Outbound `fetch` is closed by default. Before a loader or an action calls a host, add the host to the App's allowlist.

One render has a fixed fuel budget. Paginate long lists instead of rendering a whole table into one page.

When a loader or a component throws, React Router renders the `ErrorBoundary` in `app/root.tsx` with a 500. The stack is in the logs:

```bash
npx wawesome logs --follow
```

## License

MIT.

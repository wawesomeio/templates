# REST API

A REST resource — a collection, its items, and a collection nested under an item —
served across several HTTP methods by **one Function**.

Deploy it and you have six routes live at one address, at one version, rolled
back as one unit. There is no arrangement in which `GET /cus_42` and
`PUT /cus_42` are running different versions of what you think of as one
endpoint, because there is only one thing deployed.

The interesting part is not the CRUD. It is that a Function owns an entire path
space rather than a single address, and this template shows what that lets you
write: [`src/router.ts`](src/router.ts) is a route matcher short enough to read
in full, and [`src/index.ts`](src/index.ts) is a routing table above six
handlers.

## What it serves

```
GET    /              the collection
POST   /              create one
GET    /:id           read one
PUT    /:id           replace one
DELETE /:id           delete one
GET    /:id/orders    a collection nested under an item

*                     the Function's own 404
```

`OPTIONS` is answered from the same table with an accurate `Allow`, `HEAD` is
served by whatever serves `GET`, and a method a path does not serve is a `405`
that says what the path does serve. All of that falls out of the table rather
than being written six times.

```bash
curl "$API"                       # the collection
curl "$API/cus_amelia"            # one customer
curl "$API/cus_amelia/orders"     # that customer's orders
curl "$API/nothing-here"          # 404, from the Function
curl -X POST "$API" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Nadia Petrova","email":"nadia@example.com"}'
```

## Quick start

```bash
npm install
npx wawesome login
npx wawesome deploy
```

There is nothing to configure — no API key, no third-party account, no outbound
provider. `deploy` prints the address, and every route above is live at it.

## The address is a mount, not a route

```
https://api.wawesome.io/x/<workspace>/rest-api/customers/cus_42/orders
                       └─────────────── mount ──────────────┘└── path ──┘
                                    stripped                 what you route on
```

The App and Function slugs come from
[`wawesome-function.json`](wawesome-function.json), and together with your
workspace slug they form the mount. Every URL beneath that mount reaches this
Function — and the platform strips the mount before the request arrives, so the
path your code sees is **relative to it**. A call to the address itself arrives
as `/`.

That is why nothing in [`src/router.ts`](src/router.ts) names the platform's
addressing. It is not tidiness — it is what makes the code portable across the
addresses the same deployment answers at. A Preview URL puts the same version
under a *different* prefix; a Function that routed on the full path would route
differently through a Preview than through its public address, and a Preview
would stop being a rehearsal of production.

### Building links back

A Function that never sees its own address cannot build a `Location` header from
`request.url` alone. The stripped mount comes back on a header, and origin plus
mount plus the observed path reassembles the caller's URL exactly:

```ts
const url = new URL(request.url);
const prefix = request.headers.get("x-wawesome-forwarded-prefix") ?? "";

const publicUrl = url.origin + prefix + url.pathname + url.search;
```

That is all of [`src/public-url.ts`](src/public-url.ts), which is where the
`Location` on a `201` and the `self` on every item come from. `x-wawesome-` is
the platform's reserved namespace and is stripped from every inbound request
before your code runs, so a caller cannot forge that header — which is what
makes it safe to build links from. A conventional `x-forwarded-prefix` would be
whatever the caller said it was.

One shape worth knowing: at the bare mount the observed path is `/`, because no
URL can carry an empty path. A link rebuilt for that one request gains a
trailing slash the caller did not type.

## The path arrives exactly as it was typed

The platform does not normalise anything on the way in — no percent-decoding, no
collapsing of doubled separators, no trailing-slash rewriting. That is what lets
a scheme that signs a URL verify against it, and it means the decisions are
yours. This router makes them in one place, and
[`src/router.test.ts`](src/router.test.ts) pins each one:

| The caller sends | This router | Why |
| --- | --- | --- |
| `/cus_42/` | same as `/cus_42` | A trailing slash names the same resource |
| `/acme%2Feu` | one item, id `acme/eu` | Split raw, decode after — otherwise an escaped separator silently becomes a route |
| `/cus_42//orders` | `404` | An empty segment is not an identifier |
| `/cus_%zz` | `400` | Not valid percent-encoding, so there is no path to route |

Change any of them: they are four short branches, not a framework's opinion.

## The data is a fixture, and its writes are no-ops

[`src/store.ts`](src/store.ts) serves two customers and three orders from a
constant. Reads are real. **Writes are deliberate no-ops** that answer exactly as
a real store would — `POST` gives you a `201` and a well-formed `Location`, and
that address answers `404`, because nothing was written.

This is stated rather than hidden because the alternative would teach you
something false about the runtime: a Function is started fresh for each request,
so there is nowhere in the process for a write to go. An in-memory array here
would appear to work in tests and lose every write in production.

`store.ts` is the file to replace. Each function in it is a seam — keep the
signature, put your database call inside, and neither `index.ts` nor `router.ts`
changes, because they already `await` what those functions return.

Reaching a database is an outbound call like any other, and outbound access is
**default-deny per App**: whatever host your store lives on has to be added to
the App's allowlist before a `fetch` to it will connect. A call to somewhere you
did not authorise does not silently succeed.

## Adding a route

One line in the table at the top of [`src/index.ts`](src/index.ts):

```ts
const ROUTES: Route<Handler>[] = [
  { method: "GET", pattern: "/", handler: collection },
  { method: "GET", pattern: "/:id/orders", handler: orders },
  { method: "GET", pattern: "/:id/invoices", handler: invoices },
];
```

No new deploy unit, no second Function, no route registered with the platform.
The `Allow` header, the `405`, and the `OPTIONS` response all follow from the
table automatically.

If you would rather use a router you already know — `itty-router`, or anything
else that takes a `Request` and returns a `Response` — it works here unmodified.
Nothing about this Function's shape requires the one in `router.ts`; it is here
because it is readable, not because it is required.

## What this template does not do

**No authentication.** Every route is public. Anyone who has the address can read
the fixture and send writes that do nothing. Before this holds real data, check a
credential — the same place the route is matched is a fine place to do it.

**No CORS.** A Function's response carries only the headers the Function sets, so
a browser on another origin cannot call this until you say it may. That is a
policy only you can state; the
[`llm-proxy`](../llm-proxy) template has a worked example of stating it.

**No pagination.** The collection returns everything, which is correct for two
rows and wrong for two million. `self` on the collection response already carries
the query string the caller sent, which is where a cursor would go.

## Tests

```bash
npm test
npm run typecheck
```

61 tests, no mocks and no network: the router, the request validation and the
link building are pure functions, and the endpoint itself is driven by calling
its `fetch` with a real `Request`. That includes the mount being different from
production's — the suite proves the Function follows the mount it was reached at
rather than assuming one.

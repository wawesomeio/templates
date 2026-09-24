# REST API

A REST API for customers and their orders, built with [Hono](https://hono.dev) and [zod](https://zod.dev). The data lives in tables in your own [Supabase](https://supabase.com) project, so a customer you create with POST is there on the next GET.

All six routes are one Function. They ship together, run at one version and roll back as one unit.

## Quick start

Deploy first. You need no database for that:

```bash
npm install
npx wawesome login
npx wawesome deploy
```

Every route answers 503 until Supabase is set. Then, in this order:

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Open its **SQL Editor**, paste in [`schema.sql`](schema.sql), and run it. It creates the `customers` and `orders` tables and one customer with two orders.
3. Set the project URL. You find it under **Project Settings → Data API**:

   ```bash
   npx wawesome env set SUPABASE_URL https://<project-ref>.supabase.co
   ```

4. Set the secret key. You find it under **Project Settings → API Keys**:

   ```bash
   npx wawesome env set SUPABASE_KEY sb_secret_... --secret
   ```

`npx wawesome init --template rest-api` asks for the same two values. Leave them blank to follow the order above.

## Routes

```
GET    /              list the customers
POST   /              create one
GET    /:id           read one
PUT    /:id           replace one
DELETE /:id           delete one
GET    /:id/orders    list one customer's orders
```

A customer that does not exist is a 404. A body that fails the schema is a 422 that names each wrong field:

```json
{ "errors": { "email": ["Invalid email address"] } }
```

If Supabase refuses a request or cannot be reached, the answer is a 502 and the reason is in `npx wawesome logs --follow`.

```bash
curl "$API"
curl -X POST "$API" -H 'Content-Type: application/json' \
  -d '{"name":"Nadia Petrova","email":"nadia@example.com"}'
curl "$API/<id>/orders"
```

## How the platform runs it

**The address is a mount.** The Function answers at `https://api.wawesome.io/x/<workspace>/rest-api/customers`, and every path beneath that reaches it. The platform strips the mount before the request arrives, so a call to the address itself arrives as `/`. That is why the routes in [`src/index.ts`](src/index.ts) are written as `/` and `/:id`, with no base path. A preview URL puts the same code under a different mount, and the same routes still match.

**Links back use a header.** The Function never sees its own mount in the URL, so it reads it from `x-wawesome-forwarded-prefix` to build the `Location` of a new customer. The platform strips every `x-wawesome-` header a caller sends, so a caller cannot fake this one.

**Outbound calls are closed by default.** A Function can only call hosts its App allows. Setting `SUPABASE_URL` opens that one host and nothing else.

**There are no sockets.** A Function reaches the outside world with `fetch` only. [`src/supabase.ts`](src/supabase.ts) calls Supabase's REST API with plain `fetch` instead of `@supabase/supabase-js`, because that package carries a realtime client built on `WebSocket`.

**Nothing is kept between requests.** Each request starts fresh, so every write goes to Supabase. An array in memory would lose it.

## Why the secret key

The Function reads, changes and deletes rows, so it uses the secret key, which skips row-level security. `schema.sql` turns row-level security on with no policy, so the publishable key can do nothing to these tables. Keep the secret key on the server. It is stored as a secret and never sent to a browser.

## Changing it

- **The shape of a customer** is the zod schema at the top of `src/index.ts`. A new field needs a column in `schema.sql` too.
- **A new route** is one more `app.get(...)` or `app.post(...)` in `src/index.ts`.
- **Every route is public.** Authentication, CORS and pagination are yours to add.

## Tests

```bash
npm test
npm run typecheck
```

The tests call the exported `fetch` handler with a `Request` and read the `Response`. The call to Supabase is replaced with a stub, so nothing reaches the network.

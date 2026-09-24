# Contact form

A contact page that saves each message as a row in a table you own.

The page is a plain file, [`public/index.html`](public/index.html). Its form posts to the page's own address. There, one [Hono](https://hono.dev) route checks the message with [zod](https://zod.dev) and saves it to a table in your own [Supabase](https://supabase.com) project. You read the messages in Supabase's Table Editor, and you can give your client a seat there so they can read them too. You don't have to build a dashboard.

The site is for a small garden designer that doesn't exist. The copy is there so the page looks like something before you've written a word.

## Quick start

You don't need a database to deploy, so deploy first:

```bash
npm install
npx wawesome login
npx wawesome deploy
```

The page is live at the address the deploy prints. If you send a message now, the answer is a note saying the form has no database yet. Then set up Supabase, in this order:

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Open its **SQL Editor**, paste in [`schema.sql`](schema.sql), and run it.
3. Set the project URL. It's under **Project Settings → Data API**.

   ```bash
   npx wawesome env set SUPABASE_URL https://<project-ref>.supabase.co
   ```

4. Set the publishable key. It's under **Project Settings → API Keys**.

   ```bash
   npx wawesome env set SUPABASE_PUBLISHABLE_KEY sb_publishable_...
   ```

5. Send a message from the page, then open **Table Editor → enquiries**. The row is there.

`npx wawesome init --template contact-form` asks for the same two values. Leave them blank if you want to follow the steps above.

## What the route answers

The route in [`src/index.ts`](src/index.ts) takes a form post or a JSON body at the page's address.

| What happened | Form post | JSON post |
| --- | --- | --- |
| Saved | `303` to `#sent`, the thank-you note | `201 {"status":"sent"}` |
| A field is wrong | `422`, a line for each wrong field | `422 {"errors":{"email":["..."]}}` |
| No database set | `503`, a note naming the next step | `503 {"error":"..."}` |
| Supabase refused or was unreachable | `502`, the reason in your logs | `502 {"error":"..."}` |

The form has no script, so it works with JavaScript turned off. The browser checks each field before it sends, and the route checks again. Because of the `303`, reloading the thank-you note doesn't send the message twice.

```bash
curl -X POST https://<your-address> \
  -H 'Content-Type: application/json' \
  -d '{"name":"Priya Shah","email":"priya@example.com","message":"Hello"}'
```

## How the platform runs it

**The page and the route share one address.** `wawesome-function.json` names `public` as the directory of files to deploy. The platform serves a `GET` for the page straight from storage, and no code runs. A `POST` to the same address reaches the route. With one hostname, you need no CORS and no endpoint URL in the page.

**The page is on your App's own hostname.** The path form used during development, `https://api.wawesome.io/x/...`, serves no files and only reaches the route.

**The page and the route are one version.** They deploy together, and `npx wawesome version switch` rolls both back together.

**Outbound calls are closed by default.** A Function can only call the hosts its App allows. Setting `SUPABASE_URL` opens that one host and nothing else.

**There are no sockets.** [`src/supabase.ts`](src/supabase.ts) is one `fetch` to the table's REST address. We don't use `@supabase/supabase-js`, because it carries a realtime client built on `WebSocket`. The `Prefer: return=minimal` header matters. Without it, Supabase sends the new row back, and the policy doesn't let this key read it.

## Why there's no secret

The Function writes with the **publishable** key, not the secret one. `schema.sql` turns on row-level security and allows one thing, an insert into `enquiries`. So the key can add a row, but it can't read, change or delete one. If the key leaks, your messages don't. That's why it's stored as a plain variable. Never put the secret key (`sb_secret_...`) here. It skips every policy.

Anyone with the publishable key can insert rows directly and skip the route's checks. The length checks in `schema.sql` still apply to them. The email check doesn't.

Spam protection and rate limiting are yours to add.

## Changing it

- **The words and the fields** are in `public/index.html`. Edit it and deploy again.
- **The rules** are the zod schema at the top of `src/index.ts`. A new field needs an input in the page and a column in `schema.sql` too.
- **If something goes wrong**, `npx wawesome logs --follow` shows what Supabase answered when it refused a row.

## Tests

```bash
npm test
npm run typecheck
```

The tests call the exported `fetch` handler with a `Request` and read the `Response`. A stub replaces the call to Supabase, so nothing reaches the network.

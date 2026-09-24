# Contact Form

A contact page whose messages land as rows in a table you own.

The page is a plain file, [`public/index.html`](public/index.html). Its form posts to the page's own address, where one [Hono](https://hono.dev) route checks the message with [zod](https://zod.dev) and saves it to a table in your own [Supabase](https://supabase.com) project. You read the messages in Supabase's Table Editor, and you can give your client a seat there to read them too. There is no dashboard to build.

The site is a small garden designer that does not exist. The copy is there so the page looks like something before you have written a word.

## Quick start

Deploy first. You need no database for that:

```bash
npm install
npx wawesome login
npx wawesome deploy
```

The page is live at the address the deploy prints. A message sent now is answered with a note saying the form has no database yet. Then, in this order:

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Open its **SQL Editor**, paste in [`schema.sql`](schema.sql), and run it.
3. Set the project URL. You find it under **Project Settings → Data API**:

   ```bash
   npx wawesome env set SUPABASE_URL https://<project-ref>.supabase.co
   ```

4. Set the publishable key. You find it under **Project Settings → API Keys**:

   ```bash
   npx wawesome env set SUPABASE_PUBLISHABLE_KEY sb_publishable_...
   ```

5. Send a message from the page, then open **Table Editor → enquiries**. The row is there.

`npx wawesome init --template contact-form` asks for the same two values. Leave them blank to follow the order above.

## What the route answers

The route in [`src/index.ts`](src/index.ts) takes a form post or a JSON body at the page's address.

| What happened | Form post | JSON post |
| --- | --- | --- |
| Saved | `303` to `#sent`, the thank-you note | `201 {"status":"sent"}` |
| A field is wrong | `422`, a line for each wrong field | `422 {"errors":{"email":["..."]}}` |
| No database set | `503`, a note naming the next step | `503 {"error":"..."}` |
| Supabase refused or was unreachable | `502`, the reason in your logs | `502 {"error":"..."}` |

The form has no script, so it works with JavaScript turned off. The browser checks each field before it sends, and the route checks again. The `303` means a reload of the thank-you note does not send the message twice.

```bash
curl -X POST https://<your-address> \
  -H 'Content-Type: application/json' \
  -d '{"name":"Priya Shah","email":"priya@example.com","message":"Hello"}'
```

## How the platform runs it

**The page and the route share one address.** `wawesome-function.json` names `public` as the directory of files to deploy. A `GET` for the page is served straight from storage, and no code runs. A `POST` to the same address reaches the route. One hostname means no CORS and no endpoint URL to set in the page.

**The page is on your App's own hostname.** The development path form, `https://api.wawesome.io/x/...`, serves no files and reaches only the route.

**The page and the route are one version.** They deploy together, and `npx wawesome version switch` rolls both back together.

**Outbound calls are closed by default.** A Function can only call hosts its App allows. Setting `SUPABASE_URL` opens that one host and nothing else.

**There are no sockets.** [`src/supabase.ts`](src/supabase.ts) is one `fetch` to the table's REST address, not `@supabase/supabase-js`, because that package carries a realtime client built on `WebSocket`. The `Prefer: return=minimal` header matters: without it Supabase sends the new row back, and the policy refuses to let this key read it.

## Why there is no secret

The Function writes with the **publishable** key, not the secret one. `schema.sql` turns on row-level security and grants one thing: an insert into `enquiries`. So the key can add a row, and it cannot read, change or delete one. A leaked key cannot leak your messages. That is why it is stored as a plain variable. Never put the secret key (`sb_secret_...`) here. It skips every policy.

Anyone holding the publishable key can insert rows directly and skip the route's checks. The length checks in `schema.sql` still hold for them. The email check does not.

Spam protection and rate limiting are yours to add.

## Changing it

- **The words and the fields** are in `public/index.html`. Edit it and deploy again.
- **The rules** are the zod schema at the top of `src/index.ts`. A new field needs an input in the page and a column in `schema.sql` too.
- **Something went wrong**: `npx wawesome logs --follow` shows what Supabase answered when it refused a row.

## Tests

```bash
npm test
npm run typecheck
```

The tests call the exported `fetch` handler with a `Request` and read the `Response`. The call to Supabase is replaced with a stub, so nothing reaches the network.

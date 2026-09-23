# Contact Form

A contact form whose messages land as rows in a table you own.

The Function serves the page, checks what was sent, and writes each message to a
table in your own [Supabase](https://supabase.com) project. You open that table
in Supabase's Table Editor to read the messages, and you can give your client a
seat there to read them too. There is no dashboard to build.

The site is a small garden designer that does not exist. The copy is there so
the page looks like something before you have written a word.

## Quick start

Deploy first. You need no database for that:

```bash
npm install
npx wawesome login
npx wawesome deploy
```

The page is live at the address the deploy prints. A message sent now is
answered with a note saying the form has no database yet. Then, in this order:

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Open its **SQL Editor**, paste in [`schema.sql`](schema.sql), and run it.
3. Set the project URL. You find it under **Project Settings → Data API**:

   ```bash
   npx wawesome env set SUPABASE_URL https://<project-ref>.supabase.co
   ```

   This also adds that one host to your App's outbound allowlist, because a
   Function can call only the hosts its App allows.
4. Set the publishable key. You find it under **Project Settings → API Keys**:

   ```bash
   npx wawesome env set SUPABASE_PUBLISHABLE_KEY sb_publishable_...
   ```

5. Send a message from the page, then open **Table Editor → enquiries**. The row
   is there.

`npx wawesome init --template contact-form` asks for the same two values. Leave
them blank to follow the order above.

## Why there is no secret

The Function writes with the **publishable** key, not the secret one. On its own
that key could do whatever the table's grants allow. `schema.sql` turns on
row-level security and grants one thing: an insert into `enquiries`. So the key
can add a row, and it cannot read, change or delete one. A leaked key cannot
leak your messages.

That is why the key is stored as a plain variable and not a secret. Supabase
designs it to be public, and the policy is what limits it.

Never put the secret key (`sb_secret_...`) here. It skips every policy.

What the policy does **not** protect: anyone holding the publishable key can
insert rows directly, skipping the Function's validation. The length checks in
`schema.sql` still hold for them. The email check does not.

Spam protection and rate limiting are yours to add.

## What the Function answers

```
GET  /          the page, 200
POST /          a form or a JSON body
*    /other     404
```

| What happened | Form post | JSON post |
| --- | --- | --- |
| Saved | `303` to `?sent`, the thank-you page | `201 {"status":"sent"}` |
| A field is wrong | `422`, the form again, the error against the field | `422 {"errors":{"email":"..."}}` |
| No database set | `503`, a note naming the next step | `503 {"error":"..."}` |
| Supabase refused or was unreachable | `502`, the reason in your logs | `502 {"error":"..."}` |

The form is a plain HTML `<form method="post">` with no script, so it works with
JavaScript turned off. Each input has a label. An error is linked to its input
with `aria-describedby`, listed in a summary at the top, and the first input
that failed takes focus. What was typed is shown again, so the visitor fixes one
field and sends.

```bash
curl -X POST https://<your-address> \
  -H 'Content-Type: application/json' \
  -d '{"name":"Priya Shah","email":"priya@example.com","message":"Hello"}'
```

## Why plain `fetch`, not `@supabase/supabase-js`

[`src/database.ts`](src/database.ts) is one `fetch` to the table's REST
address. The `@supabase/supabase-js` package carries a realtime client built on
`WebSocket`, and a Function has no sockets. The call is short enough that there
is nothing to gain from a client library.

The `Prefer: return=minimal` header matters. Without it Supabase sends the new
row back, and the policy refuses to let this key read it.

## Editing it

- **The words and fields**: [`src/page.ts`](src/page.ts).
- **The rules**: [`src/enquiry.ts`](src/enquiry.ts). A new field needs a column
  in `schema.sql` too.
- **Something went wrong**: `npx wawesome logs --follow` shows what Supabase
  answered when it refused a row.

## Tests

```bash
npm test
npm run typecheck
```

The suite drives the handler with a `Request` and reads the `Response`. The call
to Supabase is replaced with a stub, so nothing reaches the network.

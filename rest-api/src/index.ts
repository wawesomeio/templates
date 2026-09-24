import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import * as z from "zod";
import { supabaseFrom, type Supabase } from "./supabase.js";

const CustomerDraft = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.email().max(320),
});

interface Customer {
  id: string;
  name: string;
  email: string;
  created_at: string;
}

interface Order {
  id: number;
  customer_id: string;
  total_cents: number;
  currency: string;
  placed_at: string;
}

// Only a uuid reaches PostgREST's filter syntax; anything else is a 404 before it gets there.
const ITEM = "/:id{[0-9a-fA-F-]{36}}";

const customerDraft = zValidator("json", CustomerDraft, (result, c) => {
  if (!result.success) return c.json({ errors: z.flattenError(result.error).fieldErrors }, 422);
});

const app = new Hono<{ Variables: { supabase: Supabase } }>();

app.use(async (c, next) => {
  const supabase = supabaseFrom(process.env);
  if (!supabase) {
    return c.json({ error: "No database yet: run schema.sql in Supabase, then set SUPABASE_URL and SUPABASE_KEY." }, 503);
  }
  c.set("supabase", supabase);
  await next();
});

app.get("/", async (c) => {
  return c.json(await c.var.supabase<Customer[]>("customers?select=*&order=created_at"));
});

app.post("/", customerDraft, async (c) => {
  const [created] = await c.var.supabase<Customer[]>("customers", { method: "POST", body: c.req.valid("json") });
  return c.json(created, 201, { Location: `${publicUrl(c)}/${created.id}` });
});

app.get(ITEM, async (c) => {
  const [customer] = await c.var.supabase<Customer[]>(`customers?id=eq.${c.req.param("id")}&select=*`);
  return customer ? c.json(customer) : noSuchCustomer(c);
});

app.put(ITEM, customerDraft, async (c) => {
  const [replaced] = await c.var.supabase<Customer[]>(`customers?id=eq.${c.req.param("id")}`, {
    method: "PATCH",
    body: c.req.valid("json"),
  });
  return replaced ? c.json(replaced) : noSuchCustomer(c);
});

app.delete(ITEM, async (c) => {
  const [deleted] = await c.var.supabase<Customer[]>(`customers?id=eq.${c.req.param("id")}`, { method: "DELETE" });
  return deleted ? c.body(null, 204) : noSuchCustomer(c);
});

app.get(`${ITEM}/orders`, async (c) => {
  const [customer] = await c.var.supabase<{ orders: Order[] }[]>(
    `customers?id=eq.${c.req.param("id")}&select=orders(*)&orders.order=placed_at.desc`,
  );
  return customer ? c.json(customer.orders) : noSuchCustomer(c);
});

app.notFound((c) => c.json({ error: "Not found." }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err.message);
  return c.json({ error: "The database refused the request. The reason is in your logs." }, 502);
});

function noSuchCustomer(c: Context) {
  return c.json({ error: "No such customer." }, 404);
}

function publicUrl(c: Context) {
  const url = new URL(c.req.url);
  return url.origin + (c.req.header("x-wawesome-forwarded-prefix") ?? "");
}

export default app;

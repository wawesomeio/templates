import { Hono, type Context } from "hono";
import * as z from "zod";
import { supabaseFrom } from "./supabase.js";

const Enquiry = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(200, "Keep your name to 200 characters."),
  email: z.string().trim().pipe(z.email("Enter an email address like name@example.com.").max(320)),
  message: z.string().trim().min(1, "Enter a message.").max(5000, "Keep your message to 5000 characters."),
});

const app = new Hono();

app.post("/", async (c) => {
  let body: unknown;
  try {
    body = sentAsJson(c) ? await c.req.json() : await c.req.parseBody();
  } catch {
    return refuse(c, 400, "That body could not be read.");
  }

  const result = Enquiry.safeParse(body);
  if (!result.success) {
    const errors = z.flattenError(result.error).fieldErrors;
    if (sentAsJson(c)) return c.json({ errors }, 422);
    const lines = Object.entries(errors).map(([field, messages]) => `${field}: ${messages.join(" ")}`);
    return c.text(`${lines.join("\n")}\n\nGo back and fix these. What you typed is still there.`, 422);
  }

  const insert = supabaseFrom(process.env);
  if (!insert) {
    return refuse(
      c,
      503,
      "This form has no database yet, so your message was not kept. If this is your site: run schema.sql in Supabase, then set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  await insert("enquiries", result.data);

  // See Other, so reloading the thank-you state does not send the message twice.
  return sentAsJson(c) ? c.json({ status: "sent" }, 201) : c.redirect("#sent", 303);
});

app.onError((err, c) => {
  console.error(err.message);
  return refuse(c, 500, "Your message could not be saved just now. Please try again in a few minutes.");
});

function sentAsJson(c: Context) {
  return c.req.header("content-type")?.includes("application/json") ?? false;
}

function refuse(c: Context, status: 400 | 500 | 503, error: string) {
  return sentAsJson(c) ? c.json({ error }, status) : c.text(error, status);
}

export default app;

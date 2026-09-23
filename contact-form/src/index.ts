import { databaseFrom, saveEnquiry } from "./database.js";
import { readEnquiry } from "./enquiry.js";
import { notices, renderPage, type PageState } from "./page.js";

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== "/") return text("Nothing here.", 404);

    if (request.method === "GET" || request.method === "HEAD") {
      return page({ notice: url.searchParams.has("sent") ? "sent" : undefined }, 200);
    }

    if (request.method === "POST") return submit(request);

    return text("This address answers GET and POST.", 405, { Allow: "GET, HEAD, POST" });
  },
};

async function submit(request: Request): Promise<Response> {
  const type = request.headers.get("content-type") ?? "";
  const asJson = type.includes("application/json");

  let submitted: Record<string, unknown>;
  if (asJson) {
    try {
      submitted = await request.json();
    } catch {
      return json({ error: "That body is not JSON." }, 400);
    }
    if (typeof submitted !== "object" || submitted === null || Array.isArray(submitted)) {
      return json({ error: "Send a JSON object with name, email and message." }, 400);
    }
  } else if (type.includes("application/x-www-form-urlencoded")) {
    submitted = Object.fromEntries(new URLSearchParams(await request.text()));
  } else {
    return text("Send the form as application/x-www-form-urlencoded or application/json.", 415);
  }

  const read = readEnquiry(submitted);
  if ("errors" in read) {
    return asJson ? json({ errors: read.errors }, 422) : page(read, 422);
  }

  const database = databaseFrom(process.env);
  if (!database) {
    return asJson
      ? json({ error: notices["no-database"] }, 503)
      : page({ values: read.enquiry, notice: "no-database" }, 503);
  }

  if (!(await saveEnquiry(database, read.enquiry))) {
    return asJson
      ? json({ error: notices["not-saved"] }, 502)
      : page({ values: read.enquiry, notice: "not-saved" }, 502);
  }

  // See Other, so reloading the thank-you page does not send the message twice.
  return asJson ? json({ status: "sent" }, 201) : new Response(null, { status: 303, headers: { Location: "?sent" } });
}

function page(state: PageState, status: number): Response {
  return new Response(renderPage(state), {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function text(body: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...headers },
  });
}

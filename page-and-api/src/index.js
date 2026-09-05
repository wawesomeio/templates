/**
 * One deploy: the pages a visitor loads, and the endpoint the form on them
 * posts to.
 *
 * The pages are files. They are in `public/`, they go up with this code, and on
 * your App's hostname the platform serves them without ever running this
 * handler. What reaches here is everything they do not claim — which, on a site
 * this size, is the form's POST and every address nobody deployed a page for.
 *
 * The form posts to the address it was loaded at rather than to a path of its
 * own. That is what makes this deployable anywhere without configuration: no
 * base URL in the markup, no second hostname, and no CORS, because the page and
 * the endpoint answer at the same origin by construction.
 */
import { readOrder, quote } from "./pricing.js";

/**
 * The pages this deploy carries, by the address each answers at.
 *
 * Only the development path form (`/x/<workspace>/<app>/…`) reads this: every
 * request there reaches the handler, files included, so naming the page back is
 * what makes that surface behave like the hostname a visitor uses.
 */
const pages = new Map([
  ["", "index.html"],
  ["index.html", "index.html"],
]);

const NOT_FOUND = "404.html";

export default {
  /**
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  async fetch(request) {
    const path = new URL(request.url).pathname.replace(/^\/+|\/+$/g, "");

    if (request.method === "POST") return quoteFor(request, path);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "This address answers GET and POST." }, 405, {
        Allow: "GET, HEAD, POST",
      });
    }

    const page = pages.get(path);
    return page ? document(page, 200) : document(NOT_FOUND, 404);
  },
};

/**
 * Answer with a page this deploy carried, at a status this code chose.
 *
 * `x-wawesome-document` names a file in `public/`; the platform streams it in
 * place of the body returned here, keeping the status. Naming a file the deploy
 * does not carry is a 500 with the path in the Function's logs.
 *
 * @param {string} file
 * @param {number} status
 * @returns {Response}
 */
function document(file, status) {
  return new Response(null, { status, headers: { "x-wawesome-document": file } });
}

/**
 * @param {Request} request
 * @param {string} path
 * @returns {Promise<Response>}
 */
async function quoteFor(request, path) {
  if (!pages.has(path)) {
    return json({ error: "There is no form at this address." }, 404);
  }

  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return json({ error: "Send the order as application/json." }, 415);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "That body is not JSON." }, 400);
  }

  const read = readOrder(body);
  if ("problem" in read) {
    return json({ error: read.problem, field: read.field }, 400);
  }

  return json(quote(read.order), 200);
}

/**
 * @param {unknown} body
 * @param {number} status
 * @param {Record<string, string>} [headers]
 * @returns {Response}
 */
function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

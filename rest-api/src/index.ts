import { matchRoute, type Params, type Route } from "./router.js";
import { callerUrl, resourceUrl } from "./public-url.js";
import {
  createCustomer,
  deleteCustomer,
  findCustomer,
  listCustomers,
  listOrders,
  replaceCustomer,
  type Customer,
} from "./store.js";
import { parseCustomerDraft } from "./validate.js";

/**
 * A REST resource served by one Function.
 *
 * A Function is mounted at an address and owns everything beneath it, so the
 * collection, every item, and the orders nested under an item are one deploy
 * unit: they ship together, they run at the same version, and rolling them back
 * is one operation. There is no arrangement in which `GET /cus_42` and
 * `PUT /cus_42` are at different versions of what you think of as one endpoint.
 *
 *   GET    /              the collection
 *   POST   /              create one
 *   GET    /:id           read one
 *   PUT    /:id           replace one
 *   DELETE /:id           delete one
 *   GET    /:id/orders    a collection nested under an item
 *
 * Those paths are relative to the mount, which is the only path this Function
 * ever sees — see `router.ts`. Anything beneath the mount that is not on this
 * list reaches the Function too, and the Function answers it with its own 404.
 *
 * The store behind it is a fixture whose writes are no-ops. `store.ts` is the
 * file to replace, and it says so.
 */

type Handler = (request: Request, params: Params) => Promise<Response>;

const ROUTES: Route<Handler>[] = [
  { method: "GET", pattern: "/", handler: collection },
  { method: "POST", pattern: "/", handler: create },
  { method: "GET", pattern: "/:id", handler: read },
  { method: "PUT", pattern: "/:id", handler: replace },
  { method: "DELETE", pattern: "/:id", handler: remove },
  { method: "GET", pattern: "/:id/orders", handler: orders },
];

export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const match = matchRoute(ROUTES, request.method, pathname);

    switch (match.outcome) {
      case "matched": {
        const response = await match.handler(request, match.params);
        return request.method === "HEAD" ? withoutBody(response) : response;
      }

      case "wrong-method": {
        const allow = allowHeader(match.allow);
        return request.method === "OPTIONS"
          ? new Response(null, { status: 204, headers: { Allow: allow } })
          : problem(405, `This path does not serve ${describe(request.method)}.`, { Allow: allow });
      }

      case "undecodable":
        return problem(400, "The request path is not valid percent-encoding.");

      // Every URL beneath the mount arrives here, so the ones this Function does
      // not serve are its own to refuse. The path is not quoted back: a public
      // endpoint that echoes its input is one that reflects a stranger's text.
      case "unmatched":
        return problem(404, "No such resource.");
    }
  },
};

async function collection(request: Request): Promise<Response> {
  const customers = await listCustomers();

  return Response.json({
    data: customers.map((customer) => withSelf(request, customer)),
    count: customers.length,
    self: callerUrl(request),
  });
}

async function create(request: Request): Promise<Response> {
  const draft = parseCustomerDraft(request.headers.get("content-type"), await request.text());
  if (!draft.ok) return problem(draft.status, draft.error);

  const created = await createCustomer(draft.value);

  // A real `Location`, absolute and built from the mount rather than assumed.
  // It is the address the resource *would* have, and it will answer 404 until
  // `store.ts` writes somewhere that outlives the request.
  return Response.json(withSelf(request, created), {
    status: 201,
    headers: { Location: resourceUrl(request, created.id) },
  });
}

async function read(request: Request, { id }: Params): Promise<Response> {
  const customer = await findCustomer(id);

  return customer ? Response.json(withSelf(request, customer)) : problem(404, "No such customer.");
}

async function replace(request: Request, { id }: Params): Promise<Response> {
  const draft = parseCustomerDraft(request.headers.get("content-type"), await request.text());
  if (!draft.ok) return problem(draft.status, draft.error);

  const replaced = await replaceCustomer(id, draft.value);

  return replaced ? Response.json(withSelf(request, replaced)) : problem(404, "No such customer.");
}

async function remove(_request: Request, { id }: Params): Promise<Response> {
  const deleted = await deleteCustomer(id);

  return deleted ? new Response(null, { status: 204 }) : problem(404, "No such customer.");
}

async function orders(request: Request, { id }: Params): Promise<Response> {
  // Checked rather than answered with an empty list: "this customer has no
  // orders" and "there is no such customer" are different answers, and a client
  // cannot tell them apart from `[]`.
  if (!(await findCustomer(id))) return problem(404, "No such customer.");

  const found = await listOrders(id);

  return Response.json({
    data: found,
    count: found.length,
    self: callerUrl(request),
  });
}

/** An item, carrying the address it can be fetched back from. */
function withSelf(request: Request, customer: Customer): Customer & { self: string } {
  return { ...customer, self: resourceUrl(request, customer.id) };
}

/**
 * `Allow` as the header actually has to read: the methods registered for the
 * path, plus the two the Function answers without a route of their own.
 */
function allowHeader(allow: readonly string[]): string {
  const methods = new Set(allow);
  if (methods.has("GET")) methods.add("HEAD");
  methods.add("OPTIONS");

  return [...methods].sort().join(", ");
}

function problem(status: number, error: string, headers: Record<string, string> = {}): Response {
  return Response.json({ error }, { status, headers });
}

/** A method name safe to put in a response body, whatever the caller sent. */
function describe(method: string): string {
  return /^[A-Za-z]{1,20}$/.test(method) ? method.toUpperCase() : "that method";
}

function withoutBody(response: Response): Response {
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

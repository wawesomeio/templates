/**
 * The data this API serves — and the one file to replace.
 *
 * It is a fixture, not a database. A Function is started fresh for each request,
 * so there is nowhere here for a write to go: the reads below are real, and the
 * writes are deliberate no-ops that answer exactly as a real store would. Every
 * route is exercisable the moment you deploy, and the second `GET` will not show
 * the first `POST`. That is stated rather than hidden, because a template that
 * pretended otherwise would be teaching you something false about the runtime.
 *
 * Each function below is the seam. Keep its signature, put your database call
 * inside it, make it `async`, and nothing in `index.ts` or `router.ts` changes —
 * they already `await` what these return.
 *
 * Reaching a database from here is an outbound call like any other, and outbound
 * access is default-deny per App: whatever host your store lives on has to be on
 * the App's allowlist before a `fetch` to it will connect. See the README.
 */

export interface Customer {
  id: string;
  name: string;
  email: string;
  created_at: string;
}

export interface Order {
  id: string;
  customer_id: string;
  total_cents: number;
  currency: string;
  placed_at: string;
}

/** What a client is allowed to set on a customer. See `validate.ts`. */
export interface CustomerDraft {
  name: string;
  email: string;
}

const CUSTOMERS: readonly Customer[] = [
  {
    id: "cus_amelia",
    name: "Amelia Okonkwo",
    email: "amelia@example.com",
    created_at: "2024-11-02T09:14:00.000Z",
  },
  {
    id: "cus_rafael",
    name: "Rafael Duarte",
    email: "rafael@example.com",
    created_at: "2025-03-18T16:41:00.000Z",
  },
];

const ORDERS: readonly Order[] = [
  {
    id: "ord_8801",
    customer_id: "cus_amelia",
    total_cents: 4_250,
    currency: "EUR",
    placed_at: "2025-01-07T11:02:00.000Z",
  },
  {
    id: "ord_8802",
    customer_id: "cus_amelia",
    total_cents: 1_990,
    currency: "EUR",
    placed_at: "2025-02-14T08:33:00.000Z",
  },
  {
    id: "ord_8803",
    customer_id: "cus_rafael",
    total_cents: 12_000,
    currency: "EUR",
    placed_at: "2025-04-01T19:20:00.000Z",
  },
];

export async function listCustomers(): Promise<Customer[]> {
  return [...CUSTOMERS];
}

export async function findCustomer(id: string): Promise<Customer | undefined> {
  return CUSTOMERS.find((customer) => customer.id === id);
}

export async function listOrders(customerId: string): Promise<Order[]> {
  return ORDERS.filter((order) => order.customer_id === customerId);
}

/**
 * No-op. Returns the customer a real store would have written, so the endpoint
 * can answer `201` with a `Location` that is the right shape — and that address
 * will `404`, because nothing was stored.
 */
export async function createCustomer(draft: CustomerDraft): Promise<Customer> {
  return { id: newCustomerId(), ...draft, created_at: new Date().toISOString() };
}

/** No-op. `undefined` where a real store would have found nothing to replace. */
export async function replaceCustomer(id: string, draft: CustomerDraft): Promise<Customer | undefined> {
  const existing = await findCustomer(id);
  return existing && { ...existing, ...draft };
}

/** No-op. `false` where a real store would have found nothing to delete. */
export async function deleteCustomer(id: string): Promise<boolean> {
  return (await findCustomer(id)) !== undefined;
}

/**
 * Stands in for the identifier a real store assigns. `Math.random` rather than
 * `crypto.randomUUID` on purpose: this id is admitted fiction, and it is not
 * worth implying it carries the guarantees a real one would.
 */
function newCustomerId(): string {
  return `cus_${Math.random().toString(36).slice(2, 10)}`;
}

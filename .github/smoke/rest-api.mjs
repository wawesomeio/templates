/**
 * Smoke test for the deployed rest-api template.
 *
 * Runs against a Function that has just been deployed to the real platform by
 * the published CLI, and drives it the way a REST client would. This is what
 * stands between a commit and the stable tag.
 *
 * It needs no configuration, because the template needs none: there is no key
 * to set and no provider to reach. What it is really testing is the mount — that
 * one Function answers a whole path space, that the paths it does not serve come
 * back as its own 404 rather than the platform's, and that a `Location` it built
 * from the forwarded prefix is an address that actually resolves. None of those
 * can be proven from a unit test, because a unit test supplies the mount.
 *
 * Usage: node .github/smoke/rest-api.mjs <public-address>
 */
import { readFileSync } from "node:fs";

const address = process.argv[2];
if (!address) {
  console.error("Usage: node .github/smoke/rest-api.mjs <public-address>");
  process.exit(1);
}

/**
 * Read the seeded identifier out of the template's own fixture, so this cannot
 * keep asserting a customer the template stopped shipping.
 */
function seededId() {
  const found = readFileSync("rest-api/src/store.ts", "utf-8").match(/id: "(cus_[a-z0-9_]+)"/);
  if (!found) {
    console.error("✗ Could not read a seeded customer id from rest-api/src/store.ts.");
    process.exit(1);
  }
  return found[1];
}

const SEEDED = seededId();
console.log(`→ seeded customer read from store.ts: ${SEEDED}`);

const failures = [];

async function call(method, path, { body, contentType = "application/json" } = {}) {
  const response = await fetch(address + path, {
    method,
    headers: body ? { "Content-Type": contentType } : {},
    body,
  });
  return {
    status: response.status,
    location: response.headers.get("location"),
    allow: response.headers.get("allow"),
    body: await response.text(),
  };
}

async function expect(name, run, status, bodyIncludes = "") {
  const result = await run();
  const ok = result.status === status && result.body.includes(bodyIncludes);

  console.log(`${ok ? "✓" : "✗"} ${name} — ${result.status} ${result.body.slice(0, 160)}`);
  if (!ok) {
    failures.push(`${name}: expected ${status} containing "${bodyIncludes}", got ${result.status} ${result.body}`);
  }

  return result;
}

function check(name, condition, detail) {
  console.log(`${condition ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures.push(`${name}: ${detail}`);
}

// The collection, at the Function's own address. The platform delivers this as
// `/` to the guest, which is the one path a unit test cannot construct wrongly.
const collection = await expect("the collection is served at the address itself", () => call("GET", ""), 200, SEEDED);

// The whole point of the mount: these are three different routes, all beneath
// one address, all in one Function at one version.
await expect("an item is served one segment beneath the mount", () => call("GET", `/${SEEDED}`), 200, SEEDED);
await expect(
  "a nested collection is served two segments beneath the mount",
  () => call("GET", `/${SEEDED}/orders`),
  200,
  "count",
);

// The self-links only resolve if the Function rebuilt them from the forwarded
// prefix. A Function that guessed its own address would emit a plausible URL
// that 404s, which is exactly what following one catches.
const selfLink = JSON.parse(collection.body).data?.[0]?.self;
check("every item carries an absolute self link", typeof selfLink === "string", selfLink);
if (selfLink) {
  check(
    "the self link was built from the address the caller actually used",
    selfLink.startsWith(address),
    `${selfLink} does not begin with ${address}`,
  );
  const followed = await fetch(selfLink);
  check("following the self link reaches the same item", followed.status === 200, `got ${followed.status}`);
}

const created = await expect(
  "a create is accepted and answers 201",
  () =>
    call("POST", "", { body: JSON.stringify({ name: "Nadia Petrova", email: "nadia@example.com" }) }),
  201,
  "Nadia Petrova",
);

check(
  "the created resource's Location is absolute and under this address",
  created.location?.startsWith(`${address}/`),
  `Location was ${created.location}`,
);

if (created.location) {
  // The template's central honesty: the address is the right shape and answers
  // 404, because `store.ts` is a fixture whose writes are no-ops. A change that
  // made this 200 would mean the store started persisting — at which point this
  // assertion is the one to update, deliberately.
  const followed = await fetch(created.location);
  check(
    "the created resource's Location resolves to the Function's own 404, since the store is a fixture",
    followed.status === 404,
    `got ${followed.status}`,
  );
}

await expect(
  "a replace is accepted",
  () => call("PUT", `/${SEEDED}`, { body: JSON.stringify({ name: "Nadia Petrova", email: "nadia@example.com" }) }),
  200,
  "Nadia Petrova",
);

await expect("a delete is accepted", () => call("DELETE", `/${SEEDED}`), 204);

await expect(
  "a write the endpoint cannot store is refused",
  () => call("POST", "", { body: JSON.stringify({ name: "Nadia", email: "not-an-address" }) }),
  400,
);

await expect(
  "a body that is not JSON is refused on its content type",
  () => call("POST", "", { body: "name=Nadia", contentType: "application/x-www-form-urlencoded" }),
  415,
);

// The acceptance criterion this template exists for: a path beneath the mount
// that the Function does not serve is answered *by the Function*, not by the
// platform. The distinguishing evidence is the body — the platform's own
// refusals do not carry this one.
await expect(
  "an unmatched path beneath the mount is the Function's own 404",
  () => call("GET", "/nothing/here/at/all"),
  404,
  "No such resource.",
);
await expect(
  "an unknown item beneath the mount is the Function's own 404",
  () => call("GET", "/cus_definitely_not_real"),
  404,
  "No such customer.",
);

const notAllowed = await expect("a method the path does not serve is a 405", () => call("PATCH", `/${SEEDED}`), 405);
check(
  "the 405 says what the path does serve",
  notAllowed.allow?.includes("PUT") && notAllowed.allow?.includes("DELETE"),
  `Allow was ${notAllowed.allow}`,
);

const options = await expect("OPTIONS is answered from the routing table", () => call("OPTIONS", `/${SEEDED}`), 204);
check("the OPTIONS response carries Allow", options.allow?.includes("OPTIONS"), `Allow was ${options.allow}`);

// The path reaches the guest unnormalised, so these two are the Function's own
// decisions rather than the platform's. Asserted from out here because a unit
// test cannot prove the platform left them alone.
await expect(
  "an encoded separator stays inside one segment",
  () => call("GET", "/acme%2Feu"),
  404,
  "No such customer.",
);
await expect(
  "a doubled separator is not read as an item",
  () => call("GET", `/${SEEDED}//orders`),
  404,
  "No such resource.",
);
await expect("a trailing slash names the same item", () => call("GET", `/${SEEDED}/`), 200, SEEDED);

if (failures.length > 0) {
  console.error(`\n✗ smoke test failed (${failures.length}):`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log("\n✓ rest-api smoke test passed");

/**
 * Smoke test for the deployed rest-api template.
 *
 * CI deploys it with no Supabase project behind it, which is the state a
 * customer's first deploy is in: every route answers 503 and names the next step.
 *
 * Usage: node .github/smoke/rest-api.mjs <public-address>
 */
const address = process.argv[2];
if (!address) {
  console.error("Usage: node .github/smoke/rest-api.mjs <public-address>");
  process.exit(1);
}

const failures = [];

function check(what, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${what}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(what);
}

const collection = await fetch(address);
const text = await collection.text();
check("with no database, the collection is 503", collection.status === 503, `got ${collection.status}`);
check("the answer names schema.sql as the next step", text.includes("schema.sql"), text.slice(0, 160));

const item = await fetch(`${address}/7f3c2a1e-4b5d-4c6e-8f90-1a2b3c4d5e6f/orders`);
check("a path beneath the mount reaches the Function too", item.status === 503, `got ${item.status}`);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}

console.log("\nAll checks passed.");

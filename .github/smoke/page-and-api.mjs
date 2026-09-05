/**
 * Smoke test for the deployed page-and-api template.
 *
 * Runs against a Function that has just been deployed to the real platform by
 * the published CLI, and drives both halves of it the way a visitor's browser
 * would. This is what stands between a commit and the stable tag.
 *
 * What a unit test cannot prove is here: that the page arriving over the wire is
 * the file this deploy uploaded, byte for byte, and that a POST to that same
 * address reaches the handler instead of the file.
 *
 * Usage: node .github/smoke/page-and-api.mjs <public-address>
 */
import { readFileSync } from "node:fs";

const address = process.argv[2];
if (!address) {
  console.error("Usage: node .github/smoke/page-and-api.mjs <public-address>");
  process.exit(1);
}

/** The pages as they were deployed, so nothing here asserts stale markup. */
const deployed = {
  home: readFileSync("page-and-api/public/index.html", "utf-8"),
  notFound: readFileSync("page-and-api/public/404.html", "utf-8"),
};

const failures = [];

function check(what, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${what}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(what);
}

/** The body as JSON, recorded as a check either way rather than thrown. */
function asJson(what, response) {
  try {
    const body = JSON.parse(response.text);
    check(what, true);
    return body;
  } catch {
    check(what, false, response.text.slice(0, 160));
    return {};
  }
}

async function post(path, body, contentType = "application/json") {
  const response = await fetch(address + path, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

// The page. On this address every request reaches the handler, which names the
// document back; on the App's own hostname the platform serves the same bytes
// without running anything. Either way what arrives is the file.
const page = await fetch(address);
const html = await page.text();

check("the page answers 200", page.status === 200, `got ${page.status}`);
check(
  "it answers as HTML",
  (page.headers.get("content-type") ?? "").includes("text/html"),
  page.headers.get("content-type") ?? "no content-type",
);
check("it is the file this deploy carried, byte for byte", html === deployed.home);
check(
  "the reserved namespace did not reach the caller",
  page.headers.get("x-wawesome-document") === null,
  page.headers.get("x-wawesome-document") ?? "",
);
check(
  "the platform reports no failure of its own",
  page.headers.get("x-wawesome-error") === null,
  page.headers.get("x-wawesome-error") ?? "",
);

// An address no page claims: the handler's decision, at the status it chose,
// answered with the other document the deploy carried.
const missing = await fetch(`${address}/prices/2019`);
const missingBody = await missing.text();
check("an address no page claims is a 404", missing.status === 404, `got ${missing.status}`);
check("it is answered with the not-found page", missingBody === deployed.notFound);

// The other half, at the same address, with no second hostname involved.
const quoted = await post("", { quantity: 250, colours: 2, rush: false });
check("an order posted to the page's own address is priced", quoted.status === 200, quoted.text.slice(0, 160));

const priced = asJson("the price comes back as JSON", quoted);

check(
  "the quote names its lines and a total in pence",
  Array.isArray(priced.lines) && priced.lines.length >= 2 && Number.isInteger(priced.total_pence),
  quoted.text.slice(0, 160),
);
check(
  "the total is the sum of the lines it named",
  Array.isArray(priced.lines) &&
    priced.lines.reduce((total, line) => total + line.pence, 0) === priced.total_pence,
  quoted.text.slice(0, 160),
);

const rushed = await post("", { quantity: 250, colours: 2, rush: true });
const rushedQuote = asJson("the rush price comes back as JSON", rushed);
check(
  "a rush order costs more and lands sooner",
  rushed.status === 200 &&
    rushedQuote.total_pence > priced.total_pence &&
    rushedQuote.lead_time_days < priced.lead_time_days,
  rushed.text.slice(0, 160),
);

const refused = await post("", { quantity: 3, colours: 1, rush: false });
check("an order it cannot print is refused", refused.status === 400, `got ${refused.status}`);
check("the refusal names the field", refused.text.includes("quantity"), refused.text.slice(0, 160));

const wrongType = await post("", "quantity=250", "application/x-www-form-urlencoded");
check("a body that is not JSON is refused on its type", wrongType.status === 415, `got ${wrongType.status}`);

const nowhere = await post("/prices/2019", { quantity: 250, colours: 1, rush: false });
check("there is nothing to post to where there is no page", nowhere.status === 404, `got ${nowhere.status}`);

const deleted = await fetch(address, { method: "DELETE" });
check("a method neither half answers is refused", deleted.status === 405, `got ${deleted.status}`);
check(
  "the refusal says what the address does answer",
  deleted.headers.get("allow") === "GET, HEAD, POST",
  deleted.headers.get("allow") ?? "no Allow",
);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}

console.log("\nAll checks passed.");

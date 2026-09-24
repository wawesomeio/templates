/**
 * Smoke test for the deployed react-ssr template.
 *
 * CI reaches it through the path form, where the page renders but its assets
 * do not resolve, since the template answers at the App's hostname only. So
 * this checks what the server renders and never fetches the client build.
 *
 * Usage: node .github/smoke/react-ssr.mjs <public-address>
 */
const address = process.argv[2]?.replace(/\/+$/, "");
if (!address) {
  console.error("Usage: node .github/smoke/react-ssr.mjs <public-address>");
  process.exit(1);
}

const failures = [];

function check(what, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${what}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(what);
}

const page = await fetch(`${address}/`);
const html = await page.text();
check("the list is answered", page.status === 200, `got ${page.status}`);
check("it is HTML", (page.headers.get("content-type") ?? "").startsWith("text/html"), page.headers.get("content-type"));
check(
  "the platform reports no failure of its own",
  page.headers.get("x-wawesome-error") === null,
  page.headers.get("x-wawesome-error"),
);
check("the loader's data is in the HTML", html.includes("The Left Hand of Darkness"), html.slice(0, 160));

const book = await fetch(`${address}/books/piranesi`);
check("a book's page is answered", book.status === 200, `got ${book.status}`);

const missing = await fetch(`${address}/books/no-such-book`);
check("an unknown book is 404", missing.status === 404, `got ${missing.status}`);

const posted = await fetch(`${address}/?index`, {
  method: "POST",
  body: new URLSearchParams({ title: "Dune" }),
  redirect: "manual",
});
check("the form's action redirects", posted.status === 302, `got ${posted.status}`);
check(
  "it redirects to the thank-you state",
  posted.headers.get("location") === "/?suggested=Dune",
  posted.headers.get("location") ?? "(none)",
);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}

console.log("\nAll checks passed.");

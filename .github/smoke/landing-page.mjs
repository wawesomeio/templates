/**
 * Smoke test for the deployed landing-page template.
 *
 * Runs against a Function that has just been deployed to the real platform by
 * the published CLI, and fetches it the way a visitor's browser would. This is
 * what stands between a commit and the stable tag.
 *
 * What a unit test cannot prove is here: that a page nobody uploaded a file for
 * actually arrives over the wire as HTML, and that every path beneath the mount
 * reaches it.
 *
 * Usage: node .github/smoke/landing-page.mjs <public-address>
 */
import { readFileSync } from "node:fs";

const address = process.argv[2];
if (!address) {
  console.error("Usage: node .github/smoke/landing-page.mjs <public-address>");
  process.exit(1);
}

/** The site's name, read from the template so this cannot assert stale copy. */
function siteName() {
  const found = readFileSync("landing-page/src/index.js", "utf-8").match(/name: "([^"]+)"/);
  if (!found) {
    console.error("✗ Could not read the site name from landing-page/src/index.js.");
    process.exit(1);
  }
  return found[1];
}

const NAME = siteName();
console.log(`→ site name read from src/index.js: ${NAME}`);

const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`✓ ${name}`);
    return;
  }
  console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  failures.push(name);
}

const response = await fetch(address);
const body = await response.text();

check("the page answers 200", response.status === 200, `got ${response.status}`);
check(
  "it answers as HTML",
  (response.headers.get("content-type") ?? "").includes("text/html"),
  response.headers.get("content-type") ?? "no content-type",
);
check("it is a whole document", body.startsWith("<!doctype html>"));
check("it carries the copy", body.includes(NAME));
check("it carries its styles inline", body.includes("<style>"));
check(
  "it references no file it would have had to upload",
  !/<link[^>]+stylesheet/.test(body) && !body.includes("<script"),
);
check("it carries the attribution", body.includes("Built with wawesome"));

const nested = await fetch(`${address}/somewhere-a-visitor-typed`);
check("every path beneath the mount is the page", nested.status === 200, `got ${nested.status}`);

const posted = await fetch(address, { method: "POST" });
check("a method a page does not have is refused", posted.status === 405, `got ${posted.status}`);
check("the refusal says what it does answer", posted.headers.get("allow") === "GET, HEAD");

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}

console.log("\nAll checks passed.");

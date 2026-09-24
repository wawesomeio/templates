/**
 * Smoke test for the deployed contact-form template.
 *
 * CI deploys it with no Supabase project behind it, which is the state a
 * customer's first deploy is in: the static page is served, a wrong field is
 * refused, and a valid message is answered with the note that there is no
 * database yet.
 *
 * Usage: node .github/smoke/contact-form.mjs <public-address>
 */
const address = process.argv[2];
if (!address) {
  console.error("Usage: node .github/smoke/contact-form.mjs <public-address>");
  process.exit(1);
}

const failures = [];

function check(what, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${what}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(what);
}

async function post(body, contentType) {
  const response = await fetch(address, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
    redirect: "manual",
  });
  return { status: response.status, text: await response.text() };
}

const valid = { name: "Smoke Test", email: "smoke@example.com", message: "Checking the form answers." };

const page = await fetch(address);
const html = await page.text();
check("the page answers 200", page.status === 200, `got ${page.status}`);
check("it is a form that posts to its own address", html.includes('<form method="post" action=""'));
check("the email input is labelled", html.includes('<label for="email">'));

const wrong = await post(new URLSearchParams({ ...valid, email: "not-an-address" }).toString(), "application/x-www-form-urlencoded");
check("a wrong field is 422", wrong.status === 422, `got ${wrong.status}`);
check("the answer names the email field", wrong.text.includes("email:"), wrong.text.slice(0, 160));

const unconfigured = await post(JSON.stringify(valid), "application/json");
check("with no database, a valid message is 503", unconfigured.status === 503, `got ${unconfigured.status}`);
check("the answer names schema.sql as the next step", unconfigured.text.includes("schema.sql"), unconfigured.text.slice(0, 160));

const sent = await post(new URLSearchParams(valid).toString(), "application/x-www-form-urlencoded");
check("with no database, a valid form post is 503 too", sent.status === 503, `got ${sent.status}`);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}

console.log("\nAll checks passed.");

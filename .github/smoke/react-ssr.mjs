/**
 * Smoke test for the deployed react-ssr template.
 *
 * Runs against a Function that has just been deployed to the real platform by
 * the published CLI, and drives it the way a browser would. This is what stands
 * between a commit and the stable tag.
 *
 * What it is really testing is the pair of things a unit test supplies for
 * itself: that the mount reaches the render, so every URL in the document is
 * one that actually resolves; and that the shell leaves before the awaited
 * section does, which is only observable over a real connection.
 *
 * Usage: node .github/smoke/react-ssr.mjs <public-address>
 */
const address = process.argv[2];
if (!address) {
  console.error("Usage: node .github/smoke/react-ssr.mjs <public-address>");
  process.exit(1);
}

const mount = new URL(address).pathname.replace(/\/+$/, "");
const failures = [];

function check(what, ok, detail) {
  if (ok) {
    console.log(`✓ ${what}`);
    return;
  }
  console.log(`✗ ${what}${detail ? ` — ${detail}` : ""}`);
  failures.push(what);
}

/** The document, in arrival order, so "after the shell" is answerable. */
async function readInPieces(response) {
  const decoder = new TextDecoder();
  const pieces = [];
  for await (const chunk of response.body) {
    pieces.push(decoder.decode(chunk, { stream: true }));
  }
  return pieces;
}

const response = await fetch(address);
check("the page is answered", response.status === 200, `HTTP ${response.status}`);
check(
  "it is HTML",
  (response.headers.get("content-type") ?? "").startsWith("text/html"),
  response.headers.get("content-type"),
);
check(
  "the platform reports no failure of its own",
  response.headers.get("x-wawesome-error") === null,
  response.headers.get("x-wawesome-error"),
);

const pieces = await readInPieces(response);
const document = pieces.join("");

check("React markup is in the response", document.includes("Rendered on the server"));

const shell = pieces.findIndex((piece) => piece.includes("Rendered on the server"));
const deferred = pieces.findIndex((piece) => piece.includes("Version 7 promoted"));
check(
  "the awaited section arrives after the shell",
  shell >= 0 && deferred > shell,
  `shell in piece ${shell}, awaited section in piece ${deferred}`,
);

const scripts = [...document.matchAll(/<script type="module" src="([^"]+)"/g)].map((m) => m[1]);
const styles = [...document.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
const urls = [...scripts, ...styles];

check("the document names a client bundle and a stylesheet", urls.length >= 2, urls.join(", "));
check(
  "every URL it names is under the mount it was reached at",
  urls.every((url) => url.startsWith(`${mount}/`)),
  `mount ${mount || "(root)"}, urls ${urls.join(", ")}`,
);
check(
  "the base handed to the browser is the one it rendered against",
  document.includes(`"__WAWESOME_BASE__"]=${JSON.stringify(mount)}`),
);

// Each of those addresses has to actually serve, or the page is markup with
// broken references — which is exactly what a build-time base produces.
for (const url of urls) {
  const asset = await fetch(new URL(url, address));
  check(`${url} is served`, asset.ok, `HTTP ${asset.status}`);
}

const missing = await fetch(new URL(`${mount}/assets/nothing-here.js`, address));
check("an asset no deploy carries is not found", missing.status === 404, `HTTP ${missing.status}`);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");

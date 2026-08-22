/**
 * Smoke test for the deployed scheduled-job template.
 *
 * Runs against a Function that has just been deployed to the platform by
 * the published CLI, and exercises it via the development invocation surface.
 *
 * Usage: node .github/smoke/scheduled-job.mjs <public-address>
 */
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const address = process.argv[2];
if (!address) {
  console.error("Usage: node .github/smoke/scheduled-job.mjs <public-address>");
  process.exit(1);
}

const jobSecret = `jobsec_${randomBytes(24).toString("hex")}`;

console.log("→ storing the job secret on the App");
execFileSync("npx", ["--yes", "wawesome@latest", "env", "set", "JOB_SECRET", jobSecret, "--secret"], {
  cwd: "scheduled-job",
  stdio: "inherit",
});

async function call(headers = {}) {
  const response = await fetch(address, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
  return { status: response.status, body: await response.text() };
}

const failures = [];

async function expect(name, run, expectedStatus, bodyIncludes = "") {
  const result = await run();
  const ok = result.status === expectedStatus && (bodyIncludes === "" || result.body.includes(bodyIncludes));
  console.log(`${ok ? "✓" : "✗"} ${name} — HTTP ${result.status}`);
  if (!ok) {
    failures.push(
      `${name}: expected HTTP ${expectedStatus} (body containing "${bodyIncludes}"), got HTTP ${result.status} with body: "${result.body}"`,
    );
  }
}

await expect(
  "a scheduled trigger (x-wawesome-trigger: schedule) is accepted with 204",
  () => call({ "x-wawesome-trigger": "schedule" }),
  204,
);

await expect(
  "a manual trigger (x-wawesome-trigger: manual) is accepted with 204",
  () => call({ "x-wawesome-trigger": "manual" }),
  204,
);

await expect(
  "an authenticated HTTP request with valid Bearer token is accepted with 204",
  () => call({ Authorization: `Bearer ${jobSecret}` }),
  204,
);

await expect(
  "an unauthenticated HTTP request without trigger header is rejected with 401",
  () => call(),
  401,
  "Unauthorized",
);

await expect(
  "an HTTP request with invalid Bearer token is rejected with 401",
  () => call({ Authorization: "Bearer wrong_secret" }),
  401,
  "Unauthorized",
);

if (failures.length > 0) {
  console.error(`\n✗ smoke test failed (${failures.length} failures):`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log("\n✓ scheduled-job smoke test passed");

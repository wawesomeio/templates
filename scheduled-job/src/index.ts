import { checkEndpoint } from "./check.js";

/**
 * Verify whether the incoming request is authorized to execute this job.
 *
 * Demonstrates the trigger-header check:
 * The platform passes `x-wawesome-trigger` to tell the guest how the run started:
 * - "schedule": Fired on a recurring timer by a declared Schedule.
 * - "manual": Fired by an authorized person through `wawesome invoke` or the API.
 * - "caller": Inbound HTTP request from a caller.
 *
 * Because `x-wawesome-*` is a reserved header namespace stripped from inbound
 * public requests before your code sees it, an external caller cannot forge
 * `x-wawesome-trigger`. This allows the Function to skip its own authorization check
 * for scheduled or manual background runs while keeping protection against
 * unauthorized public/manual HTTP callers.
 */
export function isAuthorizedTrigger(request: Request): boolean {
  const trigger = request.headers.get("x-wawesome-trigger");

  // Scheduled timer runs and manual triggers are authenticated by the platform.
  if (trigger === "schedule" || trigger === "manual") {
    return true;
  }

  // When called via HTTP (e.g. during local development or if exposed),
  // enforce bearer token authorization if JOB_SECRET is set.
  const jobSecret = process.env.JOB_SECRET;
  if (!jobSecret) {
    return true;
  }

  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${jobSecret}`;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const trigger = request.headers.get("x-wawesome-trigger") ?? "caller";

    // 1. Authorize: allow platform-triggered runs or verify caller credentials.
    if (!isAuthorizedTrigger(request)) {
      console.warn(`[scheduled-job] Unauthorized invocation attempt (trigger=${trigger})`);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`[scheduled-job] Starting scheduled run (trigger=${trigger})...`);

    // 2. Perform the scheduled task (health-check probe).
    const targetUrl = process.env.TARGET_URL || "https://httpbin.org/status/200";
    const result = await checkEndpoint(targetUrl);

    // 3. Log results. Structured logs are the primary output channel for background runs.
    if (result.ok) {
      console.log(
        `[scheduled-job] ✓ Health check succeeded: ${result.url} returned HTTP ${result.status} in ${result.durationMs}ms`,
      );
    } else {
      console.error(
        `[scheduled-job] ✗ Health check failed: ${result.url} returned HTTP ${result.status}${
          result.error ? ` (${result.error})` : ""
        } in ${result.durationMs}ms`,
      );
    }

    // 4. Return an empty response.
    //
    // For a scheduled background run:
    // - Nobody is waiting for an HTTP response on the other end: the response body
    //   is discarded by the platform and caller-facing bytes are zero.
    // - The status code determines the run outcome: 2xx (e.g. 204 No Content)
    //   records a successful run. Any non-2xx status records a failed run (guest fault).
    // - Scheduled runs receive the platform's invocation ceiling (execution budget)
    //   rather than caller-facing timeout bounds.
    return new Response(null, { status: 204 });
  },
};

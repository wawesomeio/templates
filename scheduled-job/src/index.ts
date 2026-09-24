import { checkEndpoint } from "./check.js";

export function isAuthorizedTrigger(request: Request): boolean {
  const trigger = request.headers.get("x-wawesome-trigger");
  if (trigger === "schedule" || trigger === "manual") {
    return true;
  }

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

    if (!isAuthorizedTrigger(request)) {
      console.warn(`[scheduled-job] Unauthorized invocation attempt (trigger=${trigger})`);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`[scheduled-job] Starting scheduled run (trigger=${trigger})...`);

    const targetUrl = process.env.TARGET_URL;
    if (!targetUrl) {
      console.error(
        "[scheduled-job] ✗ TARGET_URL is not set, so there is nothing to check. Set it with: npx wawesome env set TARGET_URL https://...",
      );
      return new Response(JSON.stringify({ error: "TARGET_URL is not set" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    const result = await checkEndpoint(targetUrl);

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

    return new Response(null, { status: 204 });
  },
};

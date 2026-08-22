export interface HealthCheckResult {
  url: string;
  ok: boolean;
  status: number;
  durationMs: number;
  error?: string;
}

/**
 * Ping an endpoint to verify its availability and measure latency.
 */
export async function checkEndpoint(url: string): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const res = await fetch(url, { method: "GET" });
    const durationMs = Date.now() - start;
    return {
      url,
      ok: res.ok,
      status: res.status,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    return {
      url,
      ok: false,
      status: 0,
      durationMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

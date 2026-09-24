export type Supabase = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;

export function supabaseFrom(env: Record<string, string | undefined>): Supabase | null {
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = env.SUPABASE_KEY?.trim();
  if (!url || !key) return null;

  return async (path, { method = "GET", body } = {}) => {
    // Not `@supabase/supabase-js`: it carries a realtime client, and this runtime has no `WebSocket`.
    const response = await fetch(`${url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: key,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Supabase answered ${method} ${path} with HTTP ${response.status}: ${await response.text()}`);
    }
    return response.json();
  };
}

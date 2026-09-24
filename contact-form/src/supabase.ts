export type Insert = (table: string, row: unknown) => Promise<void>;

export function supabaseFrom(env: Record<string, string | undefined>): Insert | null {
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return null;

  return async (table, row) => {
    // Not `@supabase/supabase-js`: it carries a realtime client, and this runtime has no `WebSocket`.
    const response = await fetch(`${url}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: key,
        "Content-Type": "application/json",
        // The policy grants no SELECT, so asking for the row back would be refused.
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });

    if (!response.ok) {
      throw new Error(`Supabase refused a row in ${table} with HTTP ${response.status}: ${await response.text()}`);
    }
  };
}

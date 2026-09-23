import type { Enquiry } from "./enquiry.js";

export interface Database {
  url: string;
  key: string;
}

export function databaseFrom(env: Record<string, string | undefined>): Database | null {
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  return url && key ? { url, key } : null;
}

export async function saveEnquiry(database: Database, enquiry: Enquiry): Promise<boolean> {
  let response: Response;
  try {
    // Not `@supabase/supabase-js`: it carries a realtime client, and this runtime has no `WebSocket`.
    response = await fetch(`${database.url}/rest/v1/enquiries`, {
      method: "POST",
      headers: {
        apikey: database.key,
        "Content-Type": "application/json",
        // The policy grants no SELECT, so asking for the row back would be refused.
        Prefer: "return=minimal",
      },
      body: JSON.stringify(enquiry),
    });
  } catch (err) {
    console.error(`Could not reach ${database.url}: ${err}`);
    return false;
  }

  if (response.ok) return true;

  console.error(`Supabase refused the enquiry (HTTP ${response.status}): ${await response.text()}`);
  return false;
}

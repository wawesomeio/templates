/**
 * What one request cost, in a form the live log panel can show.
 *
 * A proxy that hides the API key also hides the bill: the frontend no longer
 * sees what it spent, and neither does anyone reading the browser's network
 * tab. This is where that visibility comes back. One line per request, on
 * `stdout`, which is what `wawesome logs --follow` streams.
 */

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface Pricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

/**
 * Pull the usage block out of a provider response.
 *
 * Answers `null` rather than zeroes when the provider sent nothing usable:
 * zeroes would read as a free request, and an invented number in a cost log is
 * worse than an absent one.
 */
export function readUsage(payload: unknown): TokenUsage | null {
  const usage = (payload as { usage?: unknown } | null)?.usage;
  if (typeof usage !== "object" || usage === null) return null;

  const { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total } = usage as Record<string, unknown>;
  if (typeof prompt !== "number" || typeof completion !== "number") return null;

  return {
    prompt,
    completion,
    // "OpenAI-compatible" is a spectrum, and a provider that omits the total is
    // not a reason to log nothing about the parts it did send.
    total: typeof total === "number" ? total : prompt + completion,
  };
}

/**
 * The per-million-token rates, if they have been configured.
 *
 * Read from the environment rather than written into this file because model
 * prices change and a hard-coded price silently becomes a lie. Both rates or
 * neither: a half-configured pair would produce a confidently wrong number.
 */
export function readPricing(env: Record<string, string | undefined>): Pricing | null {
  const input = positiveNumber(env.USD_PER_MILLION_INPUT_TOKENS);
  const output = positiveNumber(env.USD_PER_MILLION_OUTPUT_TOKENS);
  if (input === null || output === null) return null;
  return { inputPerMillion: input, outputPerMillion: output };
}

function positiveNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function usageLine({
  model,
  usage,
  elapsedMs,
  pricing,
}: {
  model: string;
  usage: TokenUsage | null;
  elapsedMs: number;
  pricing?: Pricing | null;
}): string {
  if (!usage) return `usage model=${model} tokens=unreported ms=${elapsedMs}`;

  const parts = [
    `usage model=${model}`,
    `prompt_tokens=${usage.prompt}`,
    `completion_tokens=${usage.completion}`,
    `total_tokens=${usage.total}`,
    `ms=${elapsedMs}`,
  ];

  if (pricing) {
    const usd = (usage.prompt / 1e6) * pricing.inputPerMillion + (usage.completion / 1e6) * pricing.outputPerMillion;
    parts.push(`cost_usd=${usd.toFixed(6)}`);
  }

  return parts.join(" ");
}

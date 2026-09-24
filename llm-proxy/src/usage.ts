import type { CompletionUsage } from "openai/resources/completions";

export interface Pricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

// Both rates or neither: half a pair would log a confidently wrong price.
export function readPricing(env: Record<string, string | undefined>): Pricing | null {
  const input = rate(env.USD_PER_MILLION_INPUT_TOKENS);
  const output = rate(env.USD_PER_MILLION_OUTPUT_TOKENS);
  if (input === null || output === null) return null;
  return { inputPerMillion: input, outputPerMillion: output };
}

function rate(raw: string | undefined): number | null {
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
  usage: CompletionUsage | undefined;
  elapsedMs: number;
  pricing: Pricing | null;
}): string {
  // "unreported", never zeroes: zero would read as a free request.
  if (!usage) return `usage model=${model} tokens=unreported ms=${elapsedMs}`;

  const parts = [
    `usage model=${model}`,
    `prompt_tokens=${usage.prompt_tokens}`,
    `completion_tokens=${usage.completion_tokens}`,
    `total_tokens=${usage.total_tokens}`,
    `ms=${elapsedMs}`,
  ];

  if (pricing) {
    const usd =
      (usage.prompt_tokens / 1e6) * pricing.inputPerMillion + (usage.completion_tokens / 1e6) * pricing.outputPerMillion;
    parts.push(`cost_usd=${usd.toFixed(6)}`);
  }

  return parts.join(" ");
}

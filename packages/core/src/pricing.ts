import type { Config } from './config';

export interface Price {
  inputPerMillion: number;
  outputPerMillion: number;
}

// Prices that are stable enough to write down. Anything else is configured (LLM_PRICE_INPUT_PER_MTOK and
// LLM_PRICE_OUTPUT_PER_MTOK) or left unknown, because a made-up price in a cost report is worse than a blank.
// Check the provider's pricing page: these change.
const KNOWN: Record<string, Price> = {
  'openai:gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
};

// Local models and the offline provider cost nothing per token.
const FREE = new Set(['ollama', 'extractive']);

export function priceFor(config: Config, provider: string, model: string): Price | null {
  const { LLM_PRICE_INPUT_PER_MTOK: input, LLM_PRICE_OUTPUT_PER_MTOK: output } = config;
  if (input !== undefined && output !== undefined) {
    return { inputPerMillion: input, outputPerMillion: output };
  }
  if (FREE.has(provider)) return { inputPerMillion: 0, outputPerMillion: 0 };
  return KNOWN[`${provider}:${model}`] ?? null;
}

// In dollars. Null when the price or the token counts are not known, never a guess.
export function costOf(
  price: Price | null,
  usage: { inputTokens: number; outputTokens: number } | null,
): number | null {
  if (!price || !usage) return null;
  return (
    (usage.inputTokens * price.inputPerMillion + usage.outputTokens * price.outputPerMillion) /
    1_000_000
  );
}

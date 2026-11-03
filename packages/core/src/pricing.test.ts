import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { costOf, priceFor } from './pricing';

const usage = { inputTokens: 2_000, outputTokens: 500 };

describe('priceFor', () => {
  it('knows gpt-4o-mini', () => {
    expect(priceFor(loadConfig({}), 'openai', 'gpt-4o-mini')).toEqual({
      inputPerMillion: 0.15,
      outputPerMillion: 0.6,
    });
  });

  it('charges nothing for the offline provider and for local models', () => {
    expect(priceFor(loadConfig({}), 'extractive', 'quote-top-sources')).toEqual({
      inputPerMillion: 0,
      outputPerMillion: 0,
    });
    expect(priceFor(loadConfig({}), 'ollama', 'llama3.2')?.inputPerMillion).toBe(0);
  });

  it('does not invent a price for a model it does not know', () => {
    expect(priceFor(loadConfig({}), 'anthropic', 'some-model')).toBeNull();
    expect(priceFor(loadConfig({}), 'openai', 'gpt-unknown')).toBeNull();
  });

  it('uses the configured price over everything else', () => {
    const config = loadConfig({ LLM_PRICE_INPUT_PER_MTOK: '3', LLM_PRICE_OUTPUT_PER_MTOK: '15' });
    expect(priceFor(config, 'anthropic', 'some-model')).toEqual({
      inputPerMillion: 3,
      outputPerMillion: 15,
    });
    expect(priceFor(config, 'openai', 'gpt-4o-mini')).toEqual({
      inputPerMillion: 3,
      outputPerMillion: 15,
    });
  });

  it('ignores a price that is only half configured', () => {
    expect(
      priceFor(loadConfig({ LLM_PRICE_INPUT_PER_MTOK: '3' }), 'anthropic', 'some-model'),
    ).toBeNull();
  });
});

describe('costOf', () => {
  it('prices input and output tokens separately, per million', () => {
    // 2,000 x $0.15/M + 500 x $0.60/M = $0.0003 + $0.0003
    expect(costOf({ inputPerMillion: 0.15, outputPerMillion: 0.6 }, usage)).toBeCloseTo(0.0006, 10);
  });

  it('is zero for a free provider', () => {
    expect(costOf({ inputPerMillion: 0, outputPerMillion: 0 }, usage)).toBe(0);
  });

  it('is unknown, not zero, when the price or the token counts are missing', () => {
    expect(costOf(null, usage)).toBeNull();
    expect(costOf({ inputPerMillion: 1, outputPerMillion: 1 }, null)).toBeNull();
  });
});

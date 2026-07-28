// ============================================================
// providerCosts — per-MODEL rate lookup for metered usage
// ------------------------------------------------------------
// The cost dashboard prices per model, not per provider, because the spread
// within a provider is larger than the spread between them: gpt-4o vs
// gpt-4o-mini is 16x, Sonnet vs Opus is 5x. A per-provider flat rate would
// publish a confidently wrong dollar figure.
// ============================================================
import { describe, it, expect } from 'vitest';
import { getModelRates, costFromTokens } from './providerCosts.js';

describe('getModelRates — exact ids', () => {
  it('prices Claude Sonnet', () => {
    expect(getModelRates('CLAUDE', 'claude-sonnet-4-5')).toMatchObject({
      inputCostPer1M: 3.0, outputCostPer1M: 15.0,
    });
  });

  it('prices Claude Opus at its own, much higher rate', () => {
    expect(getModelRates('CLAUDE', 'claude-opus-4-20250514')).toMatchObject({
      inputCostPer1M: 15.0, outputCostPer1M: 75.0,
    });
  });

  it('prices gpt-4o and gpt-4o-mini differently', () => {
    expect(getModelRates('OPENAI', 'gpt-4o').inputCostPer1M).toBe(2.5);
    expect(getModelRates('OPENAI', 'gpt-4o-mini').inputCostPer1M).toBe(0.15);
  });
});

describe('getModelRates — dated ids from the API', () => {
  // Providers return dated ids no table can enumerate.
  it('matches a dated Claude id by prefix', () => {
    const r = getModelRates('CLAUDE', 'claude-sonnet-4-5-20250929');
    expect(r.matchedModel).toBe('claude-sonnet-4-5');
    expect(r.inputCostPer1M).toBe(3.0);
  });

  it('matches a dated OpenAI id by prefix', () => {
    expect(getModelRates('OPENAI', 'gpt-4o-2024-08-06').matchedModel).toBe('gpt-4o');
  });

  // THE trap: 'gpt-4o' is a prefix of 'gpt-4o-mini'. Shortest-first matching
  // would price every mini call at 16x its real rate — and the error would
  // land on the highest-volume capabilities, which are the mini ones.
  it('matches the LONGEST model prefix, so mini is never priced as gpt-4o', () => {
    const r = getModelRates('OPENAI', 'gpt-4o-mini-2024-07-18');
    expect(r.matchedModel).toBe('gpt-4o-mini');
    expect(r.inputCostPer1M).toBe(0.15);
  });
});

describe('getModelRates — the unknown', () => {
  // An unknown model must cost NOTHING rather than a plausible default: a
  // silently defaulted rate is indistinguishable from a real one.
  it.each([
    ['unknown provider', 'GEMINI', 'gemini-2.5'],
    ['unknown model', 'OPENAI', 'gpt-5-turbo'],
    ['empty model', 'OPENAI', ''],
  ])('returns null for an %s', (_label, provider, model) => {
    expect(getModelRates(provider, model)).toBeNull();
  });

  // Deliberately NOT the provider default. CLAUDE defaults to Sonnet, so an
  // Opus call whose model went unreported would be priced at a fifth of its
  // true rate — wrong, and indistinguishable from right. Defaulting is for
  // FORECASTING a call that has not happened, not for metering one that has.
  it.each([[null], [undefined]])('returns null for an absent model (%s) rather than guessing', (model) => {
    expect(getModelRates('CLAUDE', model)).toBeNull();
  });
});

describe('costFromTokens', () => {
  it('prices input and output at their separate rates', () => {
    // 1M input @ $3 + 1M output @ $15
    expect(costFromTokens('CLAUDE', 'claude-sonnet-4-5', 1_000_000, 1_000_000)).toBeCloseTo(18.0, 6);
  });

  it('is not a function of the total alone', () => {
    // Same 2M tokens, different split → different cost. This is the entire
    // reason PR-A had to stop collapsing the two.
    const a = costFromTokens('CLAUDE', 'claude-sonnet-4-5', 1_800_000, 200_000);
    const b = costFromTokens('CLAUDE', 'claude-sonnet-4-5', 200_000, 1_800_000);
    expect(a).not.toBeCloseTo(b, 4);
  });

  // The honesty rule the whole track turns on.
  it.each([
    ['input unreported', null, 800],
    ['output unreported', 2500, null],
    ['both unreported', null, null],
  ])('returns null — not 0 — when %s', (_label, input, output) => {
    expect(costFromTokens('CLAUDE', 'claude-sonnet-4-5', input, output)).toBeNull();
  });

  it('returns null for an unpriced model rather than guessing', () => {
    expect(costFromTokens('OPENAI', 'gpt-5-turbo', 1000, 1000)).toBeNull();
  });

  // Higgsfield generates video; it is billed per request, not per token.
  it('a genuinely reported zero costs 0, not null', () => {
    expect(costFromTokens('CLAUDE', 'claude-sonnet-4-5', 0, 0)).toBe(0);
  });
});

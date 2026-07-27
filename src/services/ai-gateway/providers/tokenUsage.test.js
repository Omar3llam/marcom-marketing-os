// ============================================================
// Providers — the token split (PR-A of the AI cost track)
// ------------------------------------------------------------
// Both providers used to collapse usage into ONE number: Claude summed
// input+output, OpenAI returned total_tokens. Input and output are priced ~5x
// apart on Sonnet ($3 vs $15 per 1M) and ~4x on gpt-4o, so a sum cannot be
// costed — 3,000 tokens is anywhere from $0.009 to $0.045 depending on a split
// that had already been discarded. Costing it anyway would have meant
// publishing a fabricated number.
//
// These tests pin BOTH halves of the contract:
//   1. the split is now reported, per provider, from the right source field
//   2. `tokens` is byte-for-byte what it always was (the gateway's success log
//      and providerPerformance read it — this PR must not move that number)
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const anthropicCreate = vi.hoisted(() => vi.fn());
const openaiCreate = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: anthropicCreate }; },
}));
vi.mock('openai', () => ({
  default: class { chat = { completions: { create: openaiCreate } }; },
}));
vi.mock('../../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { generateCopy as claudeGenerateCopy } from './claudeProvider.js';
import { generateCopy as openaiGenerateCopy } from './openaiProvider.js';

const BODY = JSON.stringify({ hook: 'h', body: 'b', cta: 'c', rationale: 'r' });

const claudeReply = (usage, over = {}) => ({
  content: [{ text: BODY }],
  model: 'claude-sonnet-4-5-20250929',
  usage,
  ...over,
});
const openaiReply = (usage, over = {}) => ({
  choices: [{ message: { content: BODY } }],
  model: 'gpt-4o-2024-08-06',
  usage,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  process.env.OPENAI_API_KEY = 'sk-test';
});

describe('claudeProvider — token split', () => {
  it('reports inputTokens and outputTokens separately', async () => {
    anthropicCreate.mockResolvedValue(claudeReply({ input_tokens: 2500, output_tokens: 800 }));
    const res = await claudeGenerateCopy({ diagnosis: 'X' });

    expect(res.metadata.inputTokens).toBe(2500);
    expect(res.metadata.outputTokens).toBe(800);
  });

  // Backward compat: providerPerformance and the gateway's success log read
  // `tokens`. This PR must not change the number they see.
  it('tokens still equals input + output', async () => {
    anthropicCreate.mockResolvedValue(claudeReply({ input_tokens: 2500, output_tokens: 800 }));
    const res = await claudeGenerateCopy({ diagnosis: 'X' });

    expect(res.metadata.tokens).toBe(3300);
    expect(res.metadata.tokens).toBe(res.metadata.inputTokens + res.metadata.outputTokens);
  });

  it('returns the model the API actually resolved, not the requested constant', async () => {
    anthropicCreate.mockResolvedValue(claudeReply({ input_tokens: 1, output_tokens: 1 }));
    const res = await claudeGenerateCopy({ diagnosis: 'X' });

    expect(res.metadata.model).toBe('claude-sonnet-4-5-20250929');
  });

  // "Not measured" and "measured as zero" must stay distinguishable: a cost
  // dashboard that renders an unreported call as $0.00 is stating a falsehood.
  it('reports null — not 0 — when the response carries no usage block', async () => {
    anthropicCreate.mockResolvedValue(claudeReply(undefined));
    const res = await claudeGenerateCopy({ diagnosis: 'X' });

    expect(res.metadata.inputTokens).toBeNull();
    expect(res.metadata.outputTokens).toBeNull();
  });

  // The read used to be `response.usage.input_tokens` — on a usage-less
  // response that throws INSIDE the try, classifying a successful generation as
  // a PROVIDER_ERROR and discarding text the model had already produced.
  it('a missing usage block does not turn a success into a provider error', async () => {
    anthropicCreate.mockResolvedValue(claudeReply(undefined));
    const res = await claudeGenerateCopy({ diagnosis: 'X' });

    expect(res.success).toBe(true);
    expect(res.output.body).toBe('b');
    expect(res.metadata.tokens).toBe(0);
  });

  it('a partial usage block reports the half it has', async () => {
    anthropicCreate.mockResolvedValue(claudeReply({ input_tokens: 900 }));
    const res = await claudeGenerateCopy({ diagnosis: 'X' });

    expect(res.metadata.inputTokens).toBe(900);
    expect(res.metadata.outputTokens).toBeNull();
    expect(res.metadata.tokens).toBe(900);
  });

  it('a failed call reports null tokens, never a measured zero', async () => {
    anthropicCreate.mockRejectedValue(new Error('rate limit exceeded'));
    const res = await claudeGenerateCopy({ diagnosis: 'X' });

    expect(res.success).toBe(false);
    expect(res.metadata.inputTokens).toBeNull();
    expect(res.metadata.outputTokens).toBeNull();
    expect(res.metadata.tokens).toBe(0); // unchanged legacy field
  });
});

describe('openaiProvider — token split', () => {
  it('maps prompt_tokens → inputTokens and completion_tokens → outputTokens', async () => {
    openaiCreate.mockResolvedValue(openaiReply({ prompt_tokens: 1800, completion_tokens: 500, total_tokens: 2300 }));
    const res = await openaiGenerateCopy({ diagnosis: 'X' });

    expect(res.metadata.inputTokens).toBe(1800);
    expect(res.metadata.outputTokens).toBe(500);
  });

  // OpenAI's total_tokens is authoritative and is NOT recomputed from the split.
  it('tokens still equals total_tokens verbatim', async () => {
    openaiCreate.mockResolvedValue(openaiReply({ prompt_tokens: 1800, completion_tokens: 500, total_tokens: 2300 }));
    const res = await openaiGenerateCopy({ diagnosis: 'X' });

    expect(res.metadata.tokens).toBe(2300);
  });

  it('returns the model the API actually resolved', async () => {
    openaiCreate.mockResolvedValue(openaiReply({ total_tokens: 42 }));
    const res = await openaiGenerateCopy({ diagnosis: 'X' });

    expect(res.metadata.model).toBe('gpt-4o-2024-08-06');
  });

  // Exactly the shape the existing fallback tests mock — total only, no split.
  it('reports null for a usage block with only total_tokens', async () => {
    openaiCreate.mockResolvedValue(openaiReply({ total_tokens: 42 }));
    const res = await openaiGenerateCopy({ diagnosis: 'X' });

    expect(res.success).toBe(true);
    expect(res.metadata.tokens).toBe(42);
    expect(res.metadata.inputTokens).toBeNull();
    expect(res.metadata.outputTokens).toBeNull();
  });

  it('a missing usage block does not turn a success into a provider error', async () => {
    openaiCreate.mockResolvedValue(openaiReply(undefined));
    const res = await openaiGenerateCopy({ diagnosis: 'X' });

    expect(res.success).toBe(true);
    expect(res.output.body).toBe('b');
    expect(res.metadata.tokens).toBe(0);
  });

  it('a failed call reports null tokens, never a measured zero', async () => {
    openaiCreate.mockRejectedValue(new Error('rate limit exceeded'));
    const res = await openaiGenerateCopy({ diagnosis: 'X' });

    expect(res.success).toBe(false);
    expect(res.metadata.inputTokens).toBeNull();
    expect(res.metadata.outputTokens).toBeNull();
  });
});

describe('the split survives the gateway metadata spread', () => {
  // Every capability method passes `result.metadata` through by reference and
  // the gateway spreads it — so the split reaching a CALLER is the property
  // that actually matters, not the one inside callClaude.
  it('claude: a capability method forwards the split untouched', async () => {
    anthropicCreate.mockResolvedValue(claudeReply({ input_tokens: 11, output_tokens: 22 }));
    const res = await claudeGenerateCopy({ diagnosis: 'X' });

    expect(res.metadata).toMatchObject({ inputTokens: 11, outputTokens: 22, tokens: 33 });
  });

  it('openai: a capability method forwards the split untouched', async () => {
    openaiCreate.mockResolvedValue(openaiReply({ prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 }));
    const res = await openaiGenerateCopy({ diagnosis: 'X' });

    expect(res.metadata).toMatchObject({ inputTokens: 11, outputTokens: 22, tokens: 33 });
  });
});

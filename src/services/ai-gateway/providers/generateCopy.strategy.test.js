// ============================================================
// generateCopy — the creative strategy survives BOTH providers
// ------------------------------------------------------------
// PR #256: GENERATE_COPY may now return a `strategy` object (only the first
// variant produces one). Both providers hardcode their output shape, so a naive
// prompt change would be silently dropped. These tests pin the passthrough:
// strategy is forwarded when present, and is explicit `null` (never undefined /
// dropped) when the model omits it — identical behaviour across Claude + OpenAI.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const anthropicCreate = vi.hoisted(() => vi.fn());
const openaiCreate = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: anthropicCreate };
  },
}));
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: openaiCreate } };
  },
}));
vi.mock('../../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { generateCopy as claudeGenerateCopy } from './claudeProvider.js';
import { generateCopy as openaiGenerateCopy } from './openaiProvider.js';

const claudeReply = (content) => ({
  content: [{ text: content }],
  model: 'claude-sonnet',
  usage: { input_tokens: 10, output_tokens: 20 },
});
const openaiReply = (content) => ({
  choices: [{ message: { content } }],
  model: 'gpt-4o',
  usage: { total_tokens: 42 },
});

const STRATEGY = {
  objective: 'Book viewings',
  core_message: 'Own the skyline',
  hook: 'Wake up above the city',
  visual: 'Sunset terrace, skyline behind',
  cta_direction: 'Warm — invite to a private tour',
};
const WITH_STRATEGY = JSON.stringify({
  strategy: STRATEGY,
  hook: 'Wake up above the city',
  body: 'A home that meets you at the top.',
  cta: 'Book a tour',
  rationale: 'Aspirational, sensory-led',
});
const NO_STRATEGY = JSON.stringify({
  hook: 'h', body: 'b', cta: 'c', rationale: 'r',
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  process.env.OPENAI_API_KEY = 'sk-test';
});

describe('claudeProvider.generateCopy — forwards the creative strategy', () => {
  it('forwards the full strategy object when the model returns one', async () => {
    anthropicCreate.mockResolvedValue(claudeReply(WITH_STRATEGY));
    const res = await claudeGenerateCopy({ diagnosis: 'X', isFirstVariant: true });
    expect(res.success).toBe(true);
    expect(res.output.strategy).toEqual(STRATEGY);
    // the existing fields are untouched (no regression)
    expect(res.output.body).toBe('A home that meets you at the top.');
    expect(res.output.cta).toBe('Book a tour');
  });

  it('emits strategy: null (explicit, never dropped) when the model omits it', async () => {
    anthropicCreate.mockResolvedValue(claudeReply(NO_STRATEGY));
    const res = await claudeGenerateCopy({ diagnosis: 'X' });
    expect(res.success).toBe(true);
    expect(res.output).toHaveProperty('strategy', null);
  });
});

describe('openaiProvider.generateCopy — parity: forwards the creative strategy', () => {
  it('forwards the full strategy object when the model returns one', async () => {
    openaiCreate.mockResolvedValue(openaiReply(WITH_STRATEGY));
    const res = await openaiGenerateCopy({ diagnosis: 'X', isFirstVariant: true });
    expect(res.success).toBe(true);
    expect(res.output.strategy).toEqual(STRATEGY);
    expect(res.output.body).toBe('A home that meets you at the top.');
  });

  it('emits strategy: null (explicit, never dropped) when the model omits it', async () => {
    openaiCreate.mockResolvedValue(openaiReply(NO_STRATEGY));
    const res = await openaiGenerateCopy({ diagnosis: 'X' });
    expect(res.success).toBe(true);
    expect(res.output).toHaveProperty('strategy', null);
  });
});

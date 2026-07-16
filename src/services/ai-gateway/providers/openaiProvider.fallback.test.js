// ============================================================
// openaiProvider — fallback capability methods
// ============================================================
// The 6 methods that back Claude-primary capabilities. Proves each returns the
// SAME output shape as its claudeProvider twin, that prose methods do NOT use
// json_object mode, and that failures stay structured (never throw).
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createMock = vi.hoisted(() => vi.fn());

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));
vi.mock('../../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// Prompt builders are covered by their own tests; stub to known strings so these
// tests isolate the provider's API-call + parse + shape behaviour.
vi.mock('../prompts/systemPrompts.js', () => ({ getSystemPrompt: () => 'SYSTEM' }));
vi.mock('../prompts/copyPrompts.js', () => ({ buildCopyPrompt: () => 'COPY' }));
vi.mock('../prompts/captionPrompts.js', () => ({ buildCaptionPrompt: () => 'CAPTION' }));
vi.mock('../prompts/visualBriefPrompts.js', () => ({ buildVisualBriefPrompt: () => 'VB' }));
vi.mock('../prompts/reasoningPrompts.js', () => ({ buildReasoningPrompt: () => ({ system: 'S', user: 'U' }) }));

import {
  explainVerdict, answerQuestion,
  generateAngleVariants, generateAudienceHypotheses, validateContent,
} from './openaiProvider.js';

const reply = (content) => ({ choices: [{ message: { content } }], model: 'gpt-4o', usage: { total_tokens: 42 } });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = 'sk-test';
});

describe('openaiProvider prose fallbacks — shape parity with Claude', () => {
  it('explainVerdict returns { reasoning } and does NOT force json_object mode', async () => {
    createMock.mockResolvedValue(reply('Spend is bleeding; kill it.'));
    const res = await explainVerdict({ verdict: 'KILL' });
    expect(res.success).toBe(true);
    expect(res.output).toEqual({ reasoning: 'Spend is bleeding; kill it.' });
    // prose prompt → response_format must be absent (json_object would 400 / distort)
    expect(createMock.mock.calls[0][0].response_format).toBeUndefined();
  });

  it('answerQuestion returns { answer }', async () => {
    createMock.mockResolvedValue(reply('Your best ROAS is the Eid campaign.'));
    const res = await answerQuestion({ system: 'S', user: 'U' });
    expect(res.success).toBe(true);
    expect(res.output).toEqual({ answer: 'Your best ROAS is the Eid campaign.' });
  });

  it('empty prose → structured INVALID_RESPONSE (never a fabricated answer)', async () => {
    createMock.mockResolvedValue(reply('   '));
    const res = await explainVerdict({ verdict: 'KILL' });
    expect(res.success).toBe(false);
    expect(res.error.type).toBe('INVALID_RESPONSE');
  });
});

describe('openaiProvider JSON fallbacks — shape parity with Claude', () => {
  it('generateAngleVariants returns { angles, count } from a JSON array (fenced ok)', async () => {
    createMock.mockResolvedValue(reply('```json\n[{"angle":"scarcity"},{"angle":"social proof"}]\n```'));
    const res = await generateAngleVariants({ diagnosis: 'X' });
    expect(res.success).toBe(true);
    expect(res.output.count).toBe(2);
    expect(res.output.angles[0].angle).toBe('scarcity');
    expect(res.artifacts).toHaveLength(2);
  });

  it('generateAudienceHypotheses returns { hypotheses, count }', async () => {
    createMock.mockResolvedValue(reply('[{"hypothesis":"cold lookalike"}]'));
    const res = await generateAudienceHypotheses({ diagnosis: 'X' });
    expect(res.success).toBe(true);
    expect(res.output.count).toBe(1);
  });

  it('validateContent returns { isValid, score, ... }', async () => {
    createMock.mockResolvedValue(reply('{"isValid":true,"score":90,"issues":[],"suggestions":[],"approved":true}'));
    const res = await validateContent({ content: 'ad' });
    expect(res.success).toBe(true);
    expect(res.output.isValid).toBe(true);
    expect(res.output.score).toBe(90);
  });

  it('non-array angle response → structured INVALID_RESPONSE', async () => {
    createMock.mockResolvedValue(reply('{"not":"an array"}'));
    const res = await generateAngleVariants({ diagnosis: 'X' });
    expect(res.success).toBe(false);
    expect(res.error.type).toBe('INVALID_RESPONSE');
  });

  it('API rejection → structured error, never throws', async () => {
    createMock.mockRejectedValue(new Error('429 rate limit'));
    const res = await explainVerdict({ verdict: 'KILL' });
    expect(res.success).toBe(false);
    expect(res.error.type).toBe('RATE_LIMIT');
  });
});

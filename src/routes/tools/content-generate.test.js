// ============================================================
// content-generate — real onboarding/campaign data reaches the AI gateway
// ------------------------------------------------------------
// The audit's standard, field by field: assert the `input` handed to the AI
// gateway carries the REAL values from the request body — not the hardcoded
// last-resort defaults. Also asserts the three copy calls get distinct angles.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

const execute = vi.fn();
vi.mock('../../services/ai-gateway/index.js', async (importActual) => {
  const actual = await importActual();
  return { ...actual, execute };
});

const { generateContent } = await import('./content-generate.js');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const REAL = {
  brandVoice: 'Warm & familial — Personal, story-led, MENA-rooted · Bilingual, Egyptian dialect',
  tone: 'Bold & rebellious',
  targetAudience: '25 – 34, 35 – 44 · Female-leaning · interested in Fashion',
  industry: 'E-commerce / Retail',
  objective: 'Maximize ROAS, minimize bleed',
};

function makeReq(body) {
  return { userId: 'u1', workspaceId: 'ws1', user: { uid: 'u1' }, body };
}

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue({
    success: true,
    output: { body: 'copy body', hook: 'a hook', cta: 'Get it now', hooks: ['h1', 'h2', 'h3'], prompt: 'a visual prompt' },
  });
});

describe('content-generate — grounded inputs reach the AI gateway', () => {
  it('passes the REAL brand voice / tone / audience / industry / objective / CTR, not defaults', async () => {
    const req = makeReq({
      campaignContext: { name: 'C1', adset: 'TESTING', problem: 'CTR decay', ctr: 1.85 },
      options: { copy: true, headlines: true, cta: false, visual: false, video: false },
      ...REAL,
    });
    const res = makeRes();
    await generateContent(req, res);

    expect(res.statusCode).toBe(200);
    expect(execute).toHaveBeenCalled();
    // Every execute() call should carry the real signals (copy + headlines share baseInput).
    for (const call of execute.mock.calls) {
      const { input } = call[0];
      expect(input.brandVoice).toBe(REAL.brandVoice);
      expect(input.tone).toBe(REAL.tone);
      expect(input.targetAudience).toBe(REAL.targetAudience);
      expect(input.industry).toBe(REAL.industry);
      expect(input.objective).toBe(REAL.objective);
      expect(input.currentCTR).toBe(1.85);
      expect(input.diagnosis).toBe('CTR decay');
      // None of the hardcoded fallbacks leaked through.
      expect(input.targetAudience).not.toBe('General audience');
      expect(input.industry).not.toBe('General');
    }
  });

  it('gives each of the three copy variants a distinct angle', async () => {
    const req = makeReq({
      campaignContext: { name: 'C1', adset: 'TESTING', problem: 'CTR decay', ctr: 2 },
      options: { copy: true, headlines: false, cta: false, visual: false, video: false },
      ...REAL,
    });
    await generateContent(req, makeRes());

    const angles = execute.mock.calls
      .filter((c) => c[0].input?.angle)
      .map((c) => c[0].input.angle);
    expect(angles.length).toBe(3);
    expect(new Set(angles).size).toBe(3); // all distinct
  });

  it('falls back honestly only when a signal is genuinely absent', async () => {
    const req = makeReq({
      campaignContext: null,
      options: { copy: false, headlines: true, cta: false, visual: false, video: false },
      // no brandVoice / audience / industry / objective supplied
    });
    await generateContent(req, makeRes());

    const { input } = execute.mock.calls[0][0];
    expect(input.targetAudience).toBe('General audience');
    expect(input.industry).toBe('General');
    expect(input.currentCTR).toBeNull();
  });
});

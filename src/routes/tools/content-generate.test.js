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

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    contentGeneration: { create: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: prismaMock }));

const execute = vi.fn();
vi.mock('../../services/ai-gateway/index.js', async (importActual) => {
  const actual = await importActual();
  return { ...actual, execute };
});

const { generateContent, listContentGenerations } = await import('./content-generate.js');

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
  prismaMock.user.findUnique.mockReset().mockResolvedValue({ id: 'user-uuid-1' });
  prismaMock.contentGeneration.create.mockReset().mockResolvedValue({ id: 'gen-1' });
  prismaMock.contentGeneration.findMany.mockReset().mockResolvedValue([]);
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

describe('content-generate — CTAs are harvested from the copy variants', () => {
  it('makes NO separate CTA call and NO regex word-swaps — CTAs come from the copy', async () => {
    const req = makeReq({
      campaignContext: { name: 'C1', adset: 'TESTING', problem: 'CTR decay', ctr: 1.85 },
      options: { copy: true, headlines: false, cta: true, visual: false, video: false },
      ...REAL,
    });
    const res = makeRes();
    await generateContent(req, res);

    // Exactly the 3 angle calls — NOT a 4th GENERATE_COPY for CTAs.
    const copyCalls = execute.mock.calls.filter((c) => c[0].capability === 'GENERATE_COPY');
    expect(copyCalls.length).toBe(3);
    expect(copyCalls.every((c) => Boolean(c[0].input.angle))).toBe(true);

    // CTA is the copy variant's real CTA — no 'Claim'/'free' regex substitutions.
    const { ctas } = res.body.content;
    expect(ctas).toContain('Get it now');
    expect(ctas.every((c) => c === 'Get it now')).toBe(true);
    expect(JSON.stringify(ctas)).not.toContain('Claim');
    expect(JSON.stringify(ctas)).not.toContain('free');
  });

  it('copy items are persisted as { tag, text } only (cta was an internal carrier)', async () => {
    const req = makeReq({
      options: { copy: true, headlines: false, cta: true, visual: false, video: false },
      ...REAL,
    });
    const res = makeRes();
    await generateContent(req, res);

    for (const item of res.body.content.copy) {
      expect(Object.keys(item).sort()).toEqual(['tag', 'text']);
    }
  });
});

describe('content-generate — honest empties, never another brand\'s copy', () => {
  it('returns null sections (not canned fallback copy) when generation produces nothing', async () => {
    execute.mockReset().mockResolvedValue({ success: false, output: {} });
    const req = makeReq({
      campaignContext: { name: 'C1', adset: 'TESTING', problem: 'CTR decay', ctr: 1 },
      options: { copy: true, headlines: true, cta: true, visual: true, video: false },
      ...REAL,
    });
    const res = makeRes();
    await generateContent(req, res);

    expect(res.statusCode).toBe(200);
    const { content } = res.body;
    expect(content.copy).toBeNull();
    expect(content.headlines).toBeNull();
    expect(content.ctas).toBeNull();
    expect(content.visual).toBeNull();

    // The old cross-brand fallbacks must be gone entirely.
    const blob = JSON.stringify(content);
    expect(blob).not.toContain('Built for operators');
    expect(blob).not.toContain('MENA workspaces');
    expect(blob).not.toContain('Maison Salam');
  });
});

describe('content-generate — the visual brief is grounded too', () => {
  const visualCall = () =>
    execute.mock.calls.find((c) => c[0].capability === 'GENERATE_VISUAL_PROMPT')?.[0];

  it('synthesizes visualBrief from real signals, reuses brand voice as brandStyle, passes the picked format/dimensions', async () => {
    const req = makeReq({
      campaignContext: { name: 'C1', adset: 'TESTING', problem: 'CTR decay from fatigue', ctr: 1.85 },
      options: { copy: false, headlines: false, cta: false, visual: true, video: false },
      format: 'Story / Reel (9:16)',
      dimensions: '1080×1920',
      ...REAL,
    });
    await generateContent(req, makeRes());

    const { input } = visualCall();
    // visualBrief carries the real campaign + onboarding signals (not a leaked {token}).
    expect(input.visualBrief).toContain('CTR decay from fatigue');
    expect(input.visualBrief).toContain('Maximize ROAS, minimize bleed');
    expect(input.visualBrief).toContain('Female-leaning');
    // brandStyle reuses the onboarding-derived brand voice.
    expect(input.brandStyle).toBe(REAL.brandVoice);
    // format + dimensions are the picker's real selection.
    expect(input.format).toBe('Story / Reel (9:16)');
    expect(input.dimensions).toBe('1080×1920');
  });

  it('leaves format/dimensions undefined (→ N/A downstream) when none picked — no fabrication', async () => {
    const req = makeReq({
      campaignContext: { name: 'C1', adset: 'TESTING', problem: 'CTR decay', ctr: 1 },
      options: { copy: false, headlines: false, cta: false, visual: true, video: false },
      ...REAL,
    });
    await generateContent(req, makeRes());

    const { input } = visualCall();
    expect(input.format).toBeUndefined();
    expect(input.dimensions).toBeUndefined();
  });
});

describe('content-generate — best-effort history save', () => {
  const body = {
    campaignContext: { name: 'Folla', adset: 'TESTING', problem: 'CTR decay', ctr: 1.85 },
    options: { copy: true, headlines: true, cta: false, visual: false, video: false },
    ...REAL,
  };

  it('saves the generation, resolving createdById from clerkId (NOT req.userId)', async () => {
    const res = makeRes();
    await generateContent(makeReq(body), res);

    expect(res.statusCode).toBe(200);
    // resolves the internal User.id from the Firebase uid (req.userId = 'u1')
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clerkId: 'u1' } }),
    );
    expect(prismaMock.contentGeneration.create).toHaveBeenCalledTimes(1);
    const data = prismaMock.contentGeneration.create.mock.calls[0][0].data;
    expect(data.workspaceId).toBe('ws1');
    expect(data.createdById).toBe('user-uuid-1'); // resolved id, never the raw uid 'u1'
    expect(data.content).toEqual(res.body.content);
    expect(data.context).toMatchObject({ tone: REAL.tone, industry: REAL.industry, campaignContext: body.campaignContext });
  });

  it('a save failure never fails the generation (best-effort)', async () => {
    prismaMock.contentGeneration.create.mockRejectedValueOnce(new Error('db down'));
    const res = makeRes();
    await generateContent(makeReq(body), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.content).toBeTruthy();
  });

  it('no matching user → no save attempted, generation still succeeds', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    const res = makeRes();
    await generateContent(makeReq(body), res);

    expect(res.statusCode).toBe(200);
    expect(prismaMock.contentGeneration.create).not.toHaveBeenCalled();
  });
});

describe('listContentGenerations — workspace-scoped history', () => {
  it('returns the workspace history, newest first, capped at 50', async () => {
    const rows = [{ id: 'g1', content: {}, context: {}, createdAt: new Date(), createdBy: { email: 'a@b.com' } }];
    prismaMock.contentGeneration.findMany.mockResolvedValueOnce(rows);
    const res = makeRes();
    await listContentGenerations({ workspaceId: 'ws1' }, res);

    const args = prismaMock.contentGeneration.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ workspaceId: 'ws1' });
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
    expect(args.take).toBe(50);
    expect(res.body).toEqual({ generations: rows });
  });

  it('no workspace → empty list, no DB hit', async () => {
    const res = makeRes();
    await listContentGenerations({}, res);
    expect(res.body).toEqual({ generations: [] });
    expect(prismaMock.contentGeneration.findMany).not.toHaveBeenCalled();
  });
});

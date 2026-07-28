// ============================================================
// Admin — GET /api/admin/ai-usage
// ------------------------------------------------------------
// Every number this route returns is an estimate that an operator may compare
// against a real provider invoice. The tests below are mostly about the ways it
// could quietly be wrong: pricing a model at another model's rate, presenting a
// partial sum as a total, or rendering "unknown" as zero.
// ============================================================
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    aiUsageLog: { groupBy: vi.fn(), count: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../lib/prisma.js';
import { aiUsageRouter } from './aiUsage.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/ai-usage', aiUsageRouter);
  return app;
}

/** A provider+model group as Prisma returns it. */
const group = (over = {}) => ({
  provider: 'CLAUDE',
  model: 'claude-sonnet-4-5-20250929',
  _sum: { inputTokens: 1_000_000, outputTokens: 1_000_000, tokens: 2_000_000 },
  _count: { _all: 10, inputTokens: 10 },
  ...over,
});

const get = (qs = '') => request(makeApp()).get(`/api/admin/ai-usage${qs}`);
const provider = (body, name) => body.byProvider.find((p) => p.provider === name);

beforeEach(() => {
  vi.clearAllMocks();
  // groupBy is called twice: providers first, then workspaces.
  prisma.aiUsageLog.groupBy.mockResolvedValueOnce([group()]).mockResolvedValueOnce([]);
  prisma.aiUsageLog.count.mockResolvedValue(0);
  prisma.$queryRaw.mockResolvedValue([]);
});

describe('the response shape', () => {
  it('returns byProvider, byWorkspace, byDay and a disclaimer', async () => {
    const res = await get().expect(200);

    expect(res.body).toHaveProperty('byProvider');
    expect(res.body).toHaveProperty('byWorkspace');
    expect(res.body).toHaveProperty('byDay');
    expect(res.body).toHaveProperty('disclaimer');
    expect(res.body.period).toMatchObject({ days: 30 });
  });

  // An estimate presented without that word attached becomes a bill in
  // someone's head. It rides in the payload, not only in the UI.
  it('the disclaimer names the pricing date and points at the invoices', async () => {
    const res = await get().expect(200);

    expect(res.body.disclaimer).toMatch(/estimated/i);
    expect(res.body.disclaimer).toMatch(/invoice/i);
    expect(res.body.pricingAsOf).toBe('2026-05');
  });
});

describe('the period', () => {
  it('defaults to 30 days', async () => {
    const res = await get().expect(200);
    expect(res.body.period.days).toBe(30);
  });

  it('caps at 90 days — the retention window', async () => {
    const res = await get('?days=365').expect(200);
    expect(res.body.period.days).toBe(90);
  });

  it.each([['abc'], ['0'], ['-7'], ['']])('falls back to 30 for days=%s', async (raw) => {
    const res = await get(`?days=${raw}`).expect(200);
    expect(res.body.period.days).toBe(30);
  });

  it('a junk period never reaches the query as an invalid date', async () => {
    await get('?days=abc').expect(200);
    const { where } = prisma.aiUsageLog.groupBy.mock.calls[0][0];
    expect(Number.isNaN(where.createdAt.gte.getTime())).toBe(false);
  });
});

describe('cost estimation', () => {
  it('prices input and output at their separate rates', async () => {
    const res = await get().expect(200);
    // 1M in @ $3 + 1M out @ $15
    expect(provider(res.body, 'CLAUDE').estimatedCost).toBeCloseTo(18.0, 4);
  });

  // The defect a per-provider flat rate would have shipped.
  it('prices gpt-4o-mini at its own rate, not gpt-4o’s', async () => {
    prisma.aiUsageLog.groupBy.mockReset();
    prisma.aiUsageLog.groupBy
      .mockResolvedValueOnce([
        group({ provider: 'OPENAI', model: 'gpt-4o-mini-2024-07-18',
                _sum: { inputTokens: 1_000_000, outputTokens: 1_000_000, tokens: 2_000_000 } }),
      ])
      .mockResolvedValueOnce([]);

    const res = await get().expect(200);
    // mini: $0.15 + $0.60 = $0.75. gpt-4o would be $12.50 — 16x wrong.
    expect(provider(res.body, 'OPENAI').estimatedCost).toBeCloseTo(0.75, 4);
  });

  it('sums the models of one provider into its provider total', async () => {
    prisma.aiUsageLog.groupBy.mockReset();
    prisma.aiUsageLog.groupBy
      .mockResolvedValueOnce([
        group({ provider: 'OPENAI', model: 'gpt-4o',
                _sum: { inputTokens: 1_000_000, outputTokens: 0, tokens: 1_000_000 } }),
        group({ provider: 'OPENAI', model: 'gpt-4o-mini',
                _sum: { inputTokens: 1_000_000, outputTokens: 0, tokens: 1_000_000 } }),
      ])
      .mockResolvedValueOnce([]);

    const res = await get().expect(200);
    expect(provider(res.body, 'OPENAI').estimatedCost).toBeCloseTo(2.65, 4); // 2.50 + 0.15
    expect(provider(res.body, 'OPENAI').models).toHaveLength(2);
  });
});

describe('what cannot be priced stays null', () => {
  it('unreported tokens → null, never 0', async () => {
    prisma.aiUsageLog.groupBy.mockReset();
    prisma.aiUsageLog.groupBy
      .mockResolvedValueOnce([
        group({ _sum: { inputTokens: null, outputTokens: null, tokens: null },
                _count: { _all: 4, inputTokens: 0 } }),
      ])
      .mockResolvedValueOnce([]);

    const res = await get().expect(200);
    expect(provider(res.body, 'CLAUDE').estimatedCost).toBeNull();
    expect(res.body.totals.estimatedCost).toBeNull();
  });

  // Higgsfield generates video and is billed per request, not per token.
  it('a non-token-metered provider is null, not 0', async () => {
    prisma.aiUsageLog.groupBy.mockReset();
    prisma.aiUsageLog.groupBy
      .mockResolvedValueOnce([
        group({ provider: 'HIGGSFIELD', model: 'higgsfield-v1',
                _sum: { inputTokens: null, outputTokens: null, tokens: null },
                _count: { _all: 3, inputTokens: 0 } }),
      ])
      .mockResolvedValueOnce([]);

    const res = await get().expect(200);
    expect(provider(res.body, 'HIGGSFIELD').estimatedCost).toBeNull();
  });

  it('an unknown model is null rather than a defaulted rate', async () => {
    prisma.aiUsageLog.groupBy.mockReset();
    prisma.aiUsageLog.groupBy
      .mockResolvedValueOnce([group({ provider: 'OPENAI', model: 'gpt-5-turbo' })])
      .mockResolvedValueOnce([]);

    const res = await get().expect(200);
    expect(provider(res.body, 'OPENAI').estimatedCost).toBeNull();
  });

  it('the grand total ignores unpriced providers instead of counting them as 0', async () => {
    prisma.aiUsageLog.groupBy.mockReset();
    prisma.aiUsageLog.groupBy
      .mockResolvedValueOnce([
        group(),
        group({ provider: 'HIGGSFIELD', model: 'higgsfield-v1',
                _sum: { inputTokens: null, outputTokens: null, tokens: null },
                _count: { _all: 3, inputTokens: 0 } }),
      ])
      .mockResolvedValueOnce([]);

    const res = await get().expect(200);
    expect(res.body.totals.estimatedCost).toBeCloseTo(18.0, 4);
  });
});

describe('a partial sum is reported as partial', () => {
  // Prisma's _sum SKIPS nulls, so a sum over partially-metered rows covers
  // fewer calls than were made. Presenting it as the total would understate
  // spend while looking complete.
  it('reports how many calls the estimate actually covers', async () => {
    prisma.aiUsageLog.groupBy.mockReset();
    prisma.aiUsageLog.groupBy
      .mockResolvedValueOnce([group({ _count: { _all: 10, inputTokens: 6 } })])
      .mockResolvedValueOnce([]);

    const res = await get().expect(200);
    const p = provider(res.body, 'CLAUDE');
    expect(p.calls).toBe(10);
    expect(p.pricedCalls).toBe(6);
    expect(res.body.totals.pricedCalls).toBe(6);
  });
});

describe('attribution', () => {
  it('counts unattributed calls rather than hand-waving them', async () => {
    prisma.aiUsageLog.count.mockResolvedValueOnce(120).mockResolvedValueOnce(35);

    const res = await get().expect(200);
    expect(res.body.totals).toMatchObject({ calls: 120, unattributedCalls: 35 });
  });

  it('excludes null workspaces from the per-workspace table', async () => {
    await get().expect(200);
    const workspaceQuery = prisma.aiUsageLog.groupBy.mock.calls[1][0];
    expect(workspaceQuery.where.workspaceId).toEqual({ not: null });
  });

  it('caps the workspace table at 20 rows', async () => {
    await get().expect(200);
    expect(prisma.aiUsageLog.groupBy.mock.calls[1][0].take).toBe(20);
  });
});

describe('failure', () => {
  it('returns { error } — never a trace', async () => {
    prisma.aiUsageLog.groupBy.mockReset();
    prisma.aiUsageLog.groupBy.mockRejectedValue(new Error('password authentication failed'));

    const res = await get().expect(500);
    expect(res.body).toEqual({ error: 'Failed to load AI usage' });
  });
});

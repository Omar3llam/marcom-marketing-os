// ============================================================
// getAccuracy's projection — executedAt has to survive the select
// ============================================================
// The engine opens its outcome window at `executedAt` and falls back to
// `createdAt`. That fallback is silent by design (legacy rows have no
// executedAt), which makes the Prisma `select` load-bearing in a way nothing
// else here is: omit the field and every row arrives undefined, the fallback
// fires for all of them, and the window quietly reverts to issuance with no
// error, no log line, and a plausible-looking number on the surface.
//
// This is the same class as the default-projection widening that 500'd getHome
// in PR #209 — a read whose correctness lives entirely in its field list.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { decision: { findMany: vi.fn() }, workspace: { findUnique: vi.fn() } },
}));

import { prisma } from '../../lib/prisma.js';
import { getAccuracy, buildAccuracyInputs } from './DecisionAccuracyService.js';

beforeEach(() => {
  vi.clearAllMocks();
  prisma.decision.findMany.mockResolvedValue([]);
});

describe('the select', () => {
  it('asks for executedAt — without it the window silently reverts to issuance', async () => {
    await getAccuracy('ws-1');
    expect(prisma.decision.findMany.mock.calls[0][0].select).toMatchObject({ executedAt: true });
  });

  it('still asks for createdAt — it is the legacy fallback AND the velocity axis', async () => {
    await getAccuracy('ws-1');
    expect(prisma.decision.findMany.mock.calls[0][0].select).toMatchObject({ createdAt: true });
  });
});

describe('buildAccuracyInputs', () => {
  const row = (over = {}) => ({
    id: 'd1', verdict: 'KILL', confidence: 0.8, status: 'EXECUTED',
    createdAt: '2026-07-01T00:00:00.000Z', outcomes: [], ...over,
  });

  it('carries executedAt through to the engine', () => {
    const at = '2026-07-20T00:00:00.000Z';
    expect(buildAccuracyInputs([row({ executedAt: at })])[0].executedAt).toBe(at);
  });

  it('emits null (not undefined) when a row has no executedAt', () => {
    // Both fall back the same way in the engine, but null says "asked and there
    // was none" while undefined cannot be told apart from "never selected".
    expect(buildAccuracyInputs([row()])[0].executedAt).toBeNull();
  });

  it('leaves createdAt untouched — the velocity curve still bins by issuance', () => {
    const out = buildAccuracyInputs([row({ executedAt: '2026-07-20T00:00:00.000Z' })])[0];
    expect(out.createdAt).toBe('2026-07-01T00:00:00.000Z');
  });
});

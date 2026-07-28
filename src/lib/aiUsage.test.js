// ============================================================
// recordAiUsage / cleanAiUsageLogs
// ------------------------------------------------------------
// The write is BEST-EFFORT by design (mirrors recordAdminAction): a metering
// row that can fail a customer's copy generation is strictly worse than no
// metering row. The retention sweep is deliberately the opposite — it DOES
// surface failure, because an operator invoking it needs to know it did not run.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./prisma.js', () => ({
  prisma: { aiUsageLog: { create: vi.fn(), deleteMany: vi.fn() } },
}));
vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from './prisma.js';
import { logger } from '../utils/logger.js';
import { recordAiUsage, cleanAiUsageLogs } from './aiUsage.js';

const ENTRY = {
  workspaceId: 'ws-1',
  capability: 'GENERATE_COPY',
  provider: 'CLAUDE',
  model: 'claude-sonnet-4-5-20250929',
  inputTokens: 2500,
  outputTokens: 800,
  tokens: 3300,
  latencyMs: 1200,
  attempts: 1,
  success: true,
};

const written = () => prisma.aiUsageLog.create.mock.calls.at(-1)[0].data;

beforeEach(() => {
  vi.clearAllMocks();
  prisma.aiUsageLog.create.mockResolvedValue({ id: 'row-1' });
  prisma.aiUsageLog.deleteMany.mockResolvedValue({ count: 0 });
});

describe('recordAiUsage — the happy path', () => {
  it('writes the row and reports that it landed', async () => {
    const ok = await recordAiUsage(ENTRY);

    expect(ok).toBe(true);
    expect(written()).toMatchObject({
      workspaceId: 'ws-1',
      capability: 'GENERATE_COPY',
      provider: 'CLAUDE',
      inputTokens: 2500,
      outputTokens: 800,
      tokens: 3300,
      latencyMs: 1200,
      attempts: 1,
      success: true,
      isFallback: false,
    });
  });

  it('defaults isFallback to false', async () => {
    await recordAiUsage(ENTRY);
    expect(written().isFallback).toBe(false);
  });

  it('defaults success to true', async () => {
    await recordAiUsage({ capability: 'X', provider: 'CLAUDE' });
    expect(written().success).toBe(true);
  });
});

describe('recordAiUsage — null is not zero', () => {
  // The load-bearing honesty property of the whole track. If an unreported
  // token count lands as 0, the cost view renders the call as $0.00 — a
  // fabricated measurement indistinguishable from a real one.
  it('stores unreported tokens as null, never 0', async () => {
    await recordAiUsage({ ...ENTRY, inputTokens: null, outputTokens: undefined, tokens: null });

    const row = written();
    expect(row.inputTokens).toBeNull();
    expect(row.outputTokens).toBeNull();
    expect(row.tokens).toBeNull();
    expect(row.inputTokens).not.toBe(0);
  });

  // The mirror image: `|| null` would destroy a genuine, reported zero.
  // "Billed for zero output tokens" and "told us nothing" are different facts.
  it('preserves a REPORTED zero as 0, not null', async () => {
    await recordAiUsage({ ...ENTRY, inputTokens: 0, outputTokens: 0, tokens: 0 });

    const row = written();
    expect(row.inputTokens).toBe(0);
    expect(row.outputTokens).toBe(0);
    expect(row.tokens).toBe(0);
  });

  it('an absent workspaceId is null — never a placeholder', async () => {
    await recordAiUsage({ capability: 'X', provider: 'CLAUDE' });

    const row = written();
    expect(row.workspaceId).toBeNull();
    expect(row.workspaceId).not.toBe('unknown');
  });

  it('an absent model and latency are null', async () => {
    await recordAiUsage({ capability: 'X', provider: 'CLAUDE' });

    expect(written()).toMatchObject({ model: null, latencyMs: null, attempts: null });
  });
});

describe('recordAiUsage — best effort', () => {
  it('swallows a DB failure, warns, and never rethrows', async () => {
    prisma.aiUsageLog.create.mockRejectedValue(new Error('connection refused'));

    await expect(recordAiUsage(ENTRY)).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  // A migration-lag window (table not created yet) must not take AI down.
  it('survives a missing table', async () => {
    prisma.aiUsageLog.create.mockRejectedValue(
      Object.assign(new Error('relation "ai_usage_logs" does not exist'), { code: 'P2021' }),
    );

    await expect(recordAiUsage(ENTRY)).resolves.toBe(false);
  });

  it('does not leak the DB error to the caller', async () => {
    prisma.aiUsageLog.create.mockRejectedValue(new Error('password authentication failed for user "admin"'));

    const ok = await recordAiUsage(ENTRY);
    expect(ok).toBe(false);
  });
});

describe('cleanAiUsageLogs', () => {
  afterEach(() => { delete process.env.AIUSAGE_MAX_AGE_DAYS; });

  it('deletes rows older than the cutoff and returns the count', async () => {
    prisma.aiUsageLog.deleteMany.mockResolvedValue({ count: 4_212 });

    const count = await cleanAiUsageLogs();

    expect(count).toBe(4_212);
    expect(prisma.aiUsageLog.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('cuts off at 90 days by default', async () => {
    const before = Date.now();
    await cleanAiUsageLogs();
    const { createdAt } = prisma.aiUsageLog.deleteMany.mock.calls[0][0].where;

    const days = (before - createdAt.lt.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(90, 1);
  });

  // Deletes strictly OLDER than the cutoff — `lt`, never `lte`/`gt`. An
  // inverted comparator here would delete everything EXCEPT the old rows.
  it('deletes what is older, not what is newer', async () => {
    await cleanAiUsageLogs();
    const { createdAt } = prisma.aiUsageLog.deleteMany.mock.calls[0][0].where;

    expect(createdAt).toHaveProperty('lt');
    expect(createdAt).not.toHaveProperty('gt');
    expect(createdAt).not.toHaveProperty('gte');
  });

  it('respects the AIUSAGE_MAX_AGE_DAYS override', async () => {
    process.env.AIUSAGE_MAX_AGE_DAYS = '7';
    const before = Date.now();

    await cleanAiUsageLogs();
    const { createdAt } = prisma.aiUsageLog.deleteMany.mock.calls[0][0].where;

    const days = (before - createdAt.lt.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(7, 1);
  });

  // A junk or non-positive override would otherwise put the cutoff at (or in
  // front of) now — a retention sweep that deletes the entire table.
  it.each([['abc'], ['0'], ['-30'], ['']])('falls back to 90 days for %s', async (raw) => {
    process.env.AIUSAGE_MAX_AGE_DAYS = raw;
    const before = Date.now();

    await cleanAiUsageLogs();
    const { createdAt } = prisma.aiUsageLog.deleteMany.mock.calls[0][0].where;

    const days = (before - createdAt.lt.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(90, 1);
  });

  it('surfaces a failure instead of swallowing it', async () => {
    prisma.aiUsageLog.deleteMany.mockRejectedValue(new Error('deadlock detected'));

    // Unlike the write path — a sweep that silently did nothing is a table
    // that grows forever while the logs claim it was cleaned.
    await expect(cleanAiUsageLogs()).rejects.toThrow('deadlock detected');
  });
});

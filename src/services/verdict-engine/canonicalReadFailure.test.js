// ============================================================
// B5 F-2 — a failed canonical read is a system failure, not an empty account
// ============================================================
// The defect these tests exist to prevent returning:
//
//   prisma.metricSnapshot.findMany(...).catch(() => [])
//
// An empty array is a real answer — the database was asked, and this campaign
// was never measured over the verdict window. A failed query is not that answer.
// It reached the caller wearing the same clothes, so `latestCanonicalByEntity`
// built an empty Map, partitionByCanonicalEvidence placed EVERY campaign into
// `absent` with `NO_CANONICAL_WINDOW`, and the API published a 200 whose meaning
// was "these ten campaigns were never measured" when the truth was "we could not
// look at any of them".
//
// THE THREE STATES, AND WHY THE MIDDLE ONE IS THE HARD PART
// ---------------------------------------------------------
//   query succeeds, rows       → evidence
//   query succeeds, no rows    → NO_CANONICAL_WINDOW      ← must NOT become an error
//   query fails                → CanonicalEvidenceUnavailableError
//
// It would be trivial to close F-2 by making every absence an error. That is the
// opposite failure and it is tested for first, deliberately: a campaign nobody
// has synced yet is not an outage.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    metricSnapshot: { findMany: vi.fn() },
    campaign:       { findMany: vi.fn() },
    decision:       { findMany: vi.fn() },
  },
}));
// The engine is REAL — only observed. A spy that replaced it could not answer
// the question these tests ask, which is whether it runs at all on a failed read.
vi.mock('./verdictEngine.js', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, rollupVerdicts: vi.fn(mod.rollupVerdicts) };
});
// Read in parallel with the evaluation by getConnectorVerdicts; neither is the
// subject here, and both would otherwise reach the mocked prisma client.
vi.mock('../pattern-engine/institutionalMemory.js', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, getInstitutionalMemory: vi.fn(async () => ({ status: 'NO_VALIDATED_MEMORY', records: [] })) };
});
vi.mock('../decision-memory/index.js', () => ({ getDecisionHistory: vi.fn(async () => []) }));

import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { rollupVerdicts } from './verdictEngine.js';
import {
  selectCanonicalVerdictSnapshots,
  CanonicalEvidenceUnavailableError,
  CANONICAL_EVIDENCE_READ_FAILED,
  NO_CANONICAL_WINDOW,
} from './canonicalVerdictEvidence.js';
import { getCanonicalVerdictCampaigns } from '../entity-graph/EntityGraphService.js';
import { evaluateConnectorVerdicts, getConnectorVerdicts } from './connectorVerdictService.js';
import {
  CANONICAL_VERDICT_WINDOW_DAYS, MAX_CANONICAL_EVIDENCE_AGE_DAYS, measurementAgeDays,
} from './metricWindow.js';

const SOURCE = readFileSync(fileURLToPath(new URL('./canonicalVerdictEvidence.js', import.meta.url)), 'utf8');
/** Source with comments removed — the header QUOTES the old `.catch(() => [])`
 *  to explain it, and a ratchet that cannot tell prose from a call would fire on
 *  the documentation of the very defect it guards. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const WS = 'ws-a';

// ── B5-01N — the clock is an INPUT to this suite, not an ambient fact ────────
// These fixtures used to carry absolute dates: a canonical window ending
// 2026-08-24. Nothing in this file tests freshness, but the reader it exercises
// gates on it — evidence older than MAX_CANONICAL_EVIDENCE_AGE_DAYS is refused,
// and a window ending in the future is structurally invalid. So the fixture was
// eligible on exactly four calendar days and then began failing on its own. The
// suite changed meaning because the calendar moved, not because the code did.
//
// The clock is now pinned and every temporal fixture is derived from it, so the
// scenario describes the same situation whenever it runs. canonicalFreshness
// .test.js owns the freshness BOUNDARY; this age only has to sit inside it.
const DAY = 24 * 60 * 60 * 1000;
const EVIDENCE_AGE_DAYS = 1;
const REFERENCE_NOW = '2026-08-25T13:47:11Z';
/** Materially different instants the same scenario must survive unchanged —
 *  a past one, the default, and one years out, deliberately at a day boundary. */
const REFERENCES = [['2026-01-15T00:00:00Z'], [REFERENCE_NOW], ['2030-07-15T23:59:59Z']];

const utcMidnight = (t) => Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
/** The period this suite's evidence measures: it ended EVIDENCE_AGE_DAYS ago and
 *  spans exactly CANONICAL_VERDICT_WINDOW_DAYS inclusive days. Derived from the
 *  constant rather than written out, so the row stays structurally canonical by
 *  construction instead of by coincidence — the span is metricWindow's contract,
 *  not this file's. */
const evidenceWindow = () => {
  const windowEnd = new Date(utcMidnight(new Date()) - EVIDENCE_AGE_DAYS * DAY);
  return {
    windowStart: new Date(windowEnd.getTime() - (CANONICAL_VERDICT_WINDOW_DAYS - 1) * DAY),
    windowEnd,
  };
};

const identity = (id, name) => ({
  id, name, channel: 'META', objective: 'OUTCOME_SALES',
  externalId: `ext-${id}`,
  // Long-running by construction, so the campaign is past verdictEngine's
  // MIN_DAYS learning gate at whatever instant the clock is pinned to.
  platformCreatedTime: new Date(Date.now() - 240 * DAY),
  _count: { adSets: 1 },
});
/** A canonical row rich enough to clear the eligibility gate and be scored. */
const canonicalRow = (entityId = 'c1') => {
  const { windowStart, windowEnd } = evidenceWindow();
  return {
    entityId,
    // Sync time, not measurement time — the row landed the morning after the
    // period closed. `date` only ever breaks ties between canonical rows.
    date: new Date(windowEnd.getTime() + 9 * 60 * 60 * 1000),
    source: 'META', currency: 'USD',
    spendMinor: 500_000, revenueMinor: 1_500_000, impressions: 200_000, clicks: 4_000,
    conversions: 60, roas: 3, ctr: 0.02, frequency: 2.1, reach: 95_000,
    actionMetrics: null, dailyBudgetMinor: null,
    measurementWindow: 'CUMULATIVE_30D',
    windowStart, windowEnd,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(REFERENCE_NOW));
  prisma.decision.findMany.mockResolvedValue([]);
});
afterEach(() => { vi.useRealTimers(); });

// ── TEST 1 — the state that must NOT become an error ────────────────────────
describe('1 · a successful empty read is still NO_CANONICAL_WINDOW', () => {
  it('the reader returns an empty array, not a throw', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    await expect(selectCanonicalVerdictSnapshots(WS, ['c1'])).resolves.toEqual([]);
  });

  it('every campaign lands in noCanonicalWindow with the campaign-level reason', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity('c1', 'Alpha'), identity('c2', 'Beta')]);
    prisma.metricSnapshot.findMany.mockResolvedValue([]);

    const { campaigns, noCanonicalWindow } = await getCanonicalVerdictCampaigns(WS);
    expect(campaigns).toEqual([]);
    expect(noCanonicalWindow.map((c) => c.reason)).toEqual([NO_CANONICAL_WINDOW, NO_CANONICAL_WINDOW]);
  });

  it('and the evaluation reports NO_ELIGIBLE_CAMPAIGNS — a business answer, not a failure', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity('c1', 'Alpha')]);
    prisma.metricSnapshot.findMany.mockResolvedValue([]);

    const ev = await evaluateConnectorVerdicts(WS);
    expect(ev.status).toBe('NO_ELIGIBLE_CAMPAIGNS');
    expect(ev.gatedOut).toHaveLength(1);
    expect(ev.annotated).toBeNull();
  });

  it('no workspace and no entity ids resolve without ever querying', async () => {
    await expect(selectCanonicalVerdictSnapshots(null, ['c1'])).resolves.toEqual([]);
    await expect(selectCanonicalVerdictSnapshots(WS, [])).resolves.toEqual([]);
    expect(prisma.metricSnapshot.findMany).not.toHaveBeenCalled();
  });
});

// ── TEST 2 — the happy path is untouched ────────────────────────────────────
describe('2 · a successful populated read behaves exactly as before', () => {
  // B5-01N — the same scenario at materially different calendar instants. A
  // fixture that is only eligible near its own historical date fails here
  // immediately, rather than passing for four days and then inverting.
  it.each(REFERENCES)('rows reach the caller and a verdict is produced (clock %s)', async (instant) => {
    vi.setSystemTime(new Date(instant));
    prisma.campaign.findMany.mockResolvedValue([identity('c1', 'Alpha')]);
    prisma.metricSnapshot.findMany.mockResolvedValue([canonicalRow('c1')]);

    const ev = await evaluateConnectorVerdicts(WS);
    expect(ev.status).toBe('OK');
    expect(ev.annotated).not.toBeNull();
    expect(ev.campaigns).toHaveLength(1);
    expect(rollupVerdicts).toHaveBeenCalledTimes(1);
  });

  // The fixture's age is INTENDED, and stated. Asserting the age rather than the
  // date string is what makes a reintroduced absolute `windowEnd` fail on the
  // spot instead of silently four days later, and it names the freshness policy
  // this suite depends on without re-testing the boundary that owns it.
  it.each(REFERENCES)('the evidence is deliberately fresh, not accidentally (clock %s)', (instant) => {
    vi.setSystemTime(new Date(instant));
    const { windowStart, windowEnd } = canonicalRow('c1');

    expect(measurementAgeDays(windowEnd, new Date())).toBe(EVIDENCE_AGE_DAYS);
    expect(EVIDENCE_AGE_DAYS).toBeLessThanOrEqual(MAX_CANONICAL_EVIDENCE_AGE_DAYS);
    // …and it is still a canonical period, not merely a recent one.
    expect(Math.round((windowEnd - windowStart) / DAY) + 1).toBe(CANONICAL_VERDICT_WINDOW_DAYS);
    expect(windowEnd.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('the query itself is unchanged — window, sources, level, ordering', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    await selectCanonicalVerdictSnapshots(WS, ['c1']);

    const arg = prisma.metricSnapshot.findMany.mock.calls[0][0];
    expect(arg.where.measurementWindow).toEqual({ equals: 'CUMULATIVE_30D' });
    expect(arg.where.entityLevel).toBe('CAMPAIGN');
    expect(arg.where.source.in).toContain('META');
    expect(arg.where.source.in).not.toContain('GA4');
    expect(arg.orderBy).toEqual({ date: 'asc' });
    // F-3 is NOT in this slice's scope: no date bound was added, and none removed.
    expect(arg.where.date).toBeUndefined();
    expect(arg.where.windowEnd).toBeUndefined();
  });
});

// ── TEST 3 — the central regression ─────────────────────────────────────────
describe('3 · a failed canonical query is surfaced, never converted', () => {
  it('rejects with the stable code instead of resolving to []', async () => {
    prisma.metricSnapshot.findMany.mockRejectedValue(new Error('connection terminated'));

    const err = await selectCanonicalVerdictSnapshots(WS, ['c1']).catch((e) => e);
    expect(err).toBeInstanceOf(CanonicalEvidenceUnavailableError);
    expect(err.code).toBe(CANONICAL_EVIDENCE_READ_FAILED);
    expect(Array.isArray(err)).toBe(false);
  });

  it('never resolves — the failure cannot be read as a value', async () => {
    prisma.metricSnapshot.findMany.mockRejectedValue(new Error('boom'));
    await expect(selectCanonicalVerdictSnapshots(WS, ['c1'])).rejects.toThrow();
  });

  it('keeps the underlying error as `cause` for observability, not for clients', async () => {
    const underlying = new Error('P1001: cannot reach database server');
    prisma.metricSnapshot.findMany.mockRejectedValue(underlying);

    const err = await selectCanonicalVerdictSnapshots(WS, ['c1']).catch((e) => e);
    expect(err.cause).toBe(underlying);
    // The message a caller would surface says nothing about the database internals.
    expect(err.message).not.toMatch(/P1001|database server/);
  });

  it('logs at error level with the workspace and the stable code', async () => {
    prisma.metricSnapshot.findMany.mockRejectedValue(new Error('boom'));
    await selectCanonicalVerdictSnapshots(WS, ['c1']).catch(() => {});

    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toMatchObject({
      workspaceId: WS, code: CANONICAL_EVIDENCE_READ_FAILED,
    });
  });

  it('the failure NEVER carries the reason a real absence carries', async () => {
    prisma.metricSnapshot.findMany.mockRejectedValue(new Error('boom'));
    const err = await selectCanonicalVerdictSnapshots(WS, ['c1']).catch((e) => e);
    expect(err.code).not.toBe(NO_CANONICAL_WINDOW);
    expect(JSON.stringify({ m: err.message, c: err.code })).not.toContain(NO_CANONICAL_WINDOW);
  });
});

// ── TEST 4 — the failure cannot reach the engine as an empty population ─────
describe('4 · no verdict is produced from a failed read', () => {
  beforeEach(() => {
    prisma.campaign.findMany.mockResolvedValue([identity('c1', 'Alpha'), identity('c2', 'Beta')]);
    prisma.metricSnapshot.findMany.mockRejectedValue(new Error('read timed out'));
  });

  it('getCanonicalVerdictCampaigns propagates rather than partitioning', async () => {
    await expect(getCanonicalVerdictCampaigns(WS))
      .rejects.toMatchObject({ code: CANONICAL_EVIDENCE_READ_FAILED });
  });

  it('evaluateConnectorVerdicts rejects — it does NOT report NO_ELIGIBLE_CAMPAIGNS', async () => {
    const out = await evaluateConnectorVerdicts(WS).then((v) => v, (e) => e);
    expect(out).toBeInstanceOf(Error);
    expect(out.code).toBe(CANONICAL_EVIDENCE_READ_FAILED);
    expect(out.status).toBeUndefined();
  });

  it('the verdict engine is never invoked', async () => {
    await evaluateConnectorVerdicts(WS).catch(() => {});
    expect(rollupVerdicts).not.toHaveBeenCalled();
  });

  it('the API-facing read rejects too, rather than returning verdicts: []', async () => {
    const out = await getConnectorVerdicts(WS).then((v) => v, (e) => e);
    expect(out).toBeInstanceOf(Error);
    expect(out.verdicts).toBeUndefined();
    expect(out.gatedOut).toBeUndefined();
  });
});

// ── TEST 5 — fail closed, never widen the evidence ──────────────────────────
describe('5 · a failed canonical read never falls back to weaker evidence', () => {
  it('does not re-query for operational rows after the canonical read fails', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity('c1', 'Alpha')]);
    // Canonical fails; ANY later read would succeed with perfectly good rolling
    // rows. The point is that no later read is attempted.
    prisma.metricSnapshot.findMany
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([{ ...canonicalRow('c1'), measurementWindow: 'ROLLING_WINDOW' }]);

    await expect(evaluateConnectorVerdicts(WS)).rejects.toThrow();
    expect(prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(1);
  });

  it('the failure path in source contains no fallback of any kind', () => {
    const catchBlock = CODE.slice(CODE.indexOf('} catch (err) {'));
    // No widening, no substitution, no synthesized emptiness.
    expect(catchBlock).not.toMatch(/ROLLING_WINDOW|OPERATIONAL|LEGACY_UNKNOWN/);
    expect(catchBlock).not.toMatch(/return\s*\[\s*\]/);
    expect(catchBlock).not.toMatch(/return\s+null/);
    expect(catchBlock).toMatch(/throw new CanonicalEvidenceUnavailableError/);
  });

  it('the reader holds no cache a stale result could be served from', () => {
    // A module-level Map/cache would let a failed read answer with another
    // workspace's rows, which is the same collapse with a worse blast radius.
    expect(CODE).not.toMatch(/^const\s+\w*[Cc]ache\w*\s*=/m);
    expect(CODE).not.toMatch(/^let\s+\w*(last|cached)\w*\s*=/mi);
  });
});

// ── TEST 6 — workspace isolation across a failure ───────────────────────────
describe('6 · a failure in one workspace cannot leak into another', () => {
  it('a later workspace queries for itself and gets its own rows', async () => {
    prisma.metricSnapshot.findMany.mockRejectedValueOnce(new Error('boom'));
    await selectCanonicalVerdictSnapshots('ws-a', ['a1']).catch(() => {});

    prisma.metricSnapshot.findMany.mockResolvedValueOnce([canonicalRow('b1')]);
    const rows = await selectCanonicalVerdictSnapshots('ws-b', ['b1']);

    expect(rows.map((r) => r.entityId)).toEqual(['b1']);
    expect(prisma.metricSnapshot.findMany.mock.calls[1][0].where.workspaceId).toBe('ws-b');
    expect(prisma.metricSnapshot.findMany.mock.calls[1][0].where.entityId).toEqual({ in: ['b1'] });
  });

  it('the failed workspace yields nothing at all — not the other workspace rows', async () => {
    prisma.metricSnapshot.findMany.mockResolvedValueOnce([canonicalRow('b1')]);
    await selectCanonicalVerdictSnapshots('ws-b', ['b1']);

    prisma.metricSnapshot.findMany.mockRejectedValueOnce(new Error('boom'));
    const err = await selectCanonicalVerdictSnapshots('ws-a', ['a1']).catch((e) => e);
    expect(err.code).toBe(CANONICAL_EVIDENCE_READ_FAILED);
    expect(err.rows).toBeUndefined();
  });
});

// ── The invariant, asserted on the source itself ────────────────────────────
describe('the swallow cannot come back unnoticed', () => {
  it('the canonical reader has no catch that returns a value', () => {
    expect(CODE).not.toMatch(/\.catch\(\s*\(\s*\)\s*=>\s*\[\s*\]\s*\)/);
    expect(CODE).not.toMatch(/\.catch\([^)]*\)\s*=>\s*\[\s*\]/);
  });

  it('the two absences are different KINDS, not two values of one thing', () => {
    // NO_CANONICAL_WINDOW is a string a row carries; the failure is a class.
    expect(typeof NO_CANONICAL_WINDOW).toBe('string');
    expect(new CanonicalEvidenceUnavailableError()).toBeInstanceOf(Error);
    expect(CANONICAL_EVIDENCE_READ_FAILED).not.toBe(NO_CANONICAL_WINDOW);
  });
});

import { canonicalContentHash } from '../verdict-engine/evidenceReference.js';
// ============================================================
// B5-01F · F-3B / F-13 — a valid measurement may still be too old to decide
// ============================================================
// B5-01E proved WHICH canonical row is the right one. It said nothing about
// whether that row is recent enough to support a verdict today, and the
// simulation that closed B5-02 showed exactly what that cost: the same campaign
// produced an identical KILL at 0.59 confidence whether its measurement window
// ended today or seven months ago. Byte-identical — nothing downstream could
// tell the two apart.
//
// The rule (product ruling, 2026-08-26):
//
//   measurementAgeDays = UTC_DAY(now) - UTC_DAY(windowEnd)
//   age <= 3  → current, eligible
//   age >  3  → CANONICAL_EVIDENCE_STALE, gated out
//
// TWO THINGS THIS SUITE GUARDS AS HARD AS THE GATE ITSELF
// --------------------------------------------------------
//   1. STALE IS NOT MISSING. A campaign measured properly in January has not
//      "never been measured", and saying so would be the same class of lie
//      B5-01B/01C/01D each removed one layer down.
//   2. AGE COMES FROM windowEnd, NEVER FROM `date`. Re-syncing a January period
//      today writes today's sync timestamp onto January's measurement. Test 10
//      is the whole reason this distinction is load-bearing.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { campaign: { findMany: vi.fn() }, $queryRaw: vi.fn() },
}));
vi.mock('../evidence/index.js', () => ({ selectOperationalSnapshots: vi.fn(async () => []) }));

import { prisma } from '../../lib/prisma.js';
import { getCanonicalVerdictCampaigns } from './EntityGraphService.js';
import {
  partitionByCanonicalEvidence, NO_CANONICAL_WINDOW, CANONICAL_EVIDENCE_STALE,
} from '../verdict-engine/canonicalVerdictEvidence.js';
import {
  measurementAgeDays, MAX_CANONICAL_EVIDENCE_AGE_DAYS, REJECTION,
} from '../verdict-engine/metricWindow.js';

const GRAPH = readFileSync(fileURLToPath(new URL('./EntityGraphService.js', import.meta.url)), 'utf8');
const EVIDENCE = readFileSync(fileURLToPath(new URL('../verdict-engine/canonicalVerdictEvidence.js', import.meta.url)), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const WS = 'ws-f';
const DAY = 86_400_000;
const NOW = new Date('2026-08-26T09:00:00.000Z');

const identity = (id = 'c1', name = 'Always On') => ({
  id, name, channel: 'META', objective: 'OUTCOME_SALES',
  externalId: `ext-${id}`, platformCreatedTime: new Date('2025-06-01T00:00:00Z'),
  _count: { adSets: 1 },
});

/** A structurally VALID canonical row whose window ended `ageDays` ago. */
const snap = ({ entityId = 'c1', ageDays = 0, syncedAt = null, endHour = '00:00', spendMinor = 500_000 } = {}) => {
  const endDay = new Date(NOW.getTime() - ageDays * DAY).toISOString().slice(0, 10);
  const windowEnd = new Date(`${endDay}T${endHour}:00.000Z`);
  const windowStart = new Date(windowEnd.getTime() - 29 * DAY);
  return {
    entityId, source: 'META', currency: 'USD', measurementWindow: 'CUMULATIVE_30D',
    windowStart, windowEnd,
    date: syncedAt ? new Date(syncedAt) : windowEnd,
    spendMinor, revenueMinor: 200_000, impressions: 400_000, clicks: 6_000,
    conversions: 10, roas: 0.4, ctr: 0.015, frequency: 4.4, reach: 90_000,
    actionMetrics: null, dailyBudgetMinor: null,
  };
};

const arrange = (rows, identities = [identity()]) => {
  prisma.campaign.findMany.mockResolvedValue(identities);
  prisma.$queryRaw.mockResolvedValue(captured(rows));
};

/** getCanonicalVerdictCampaigns reads the clock itself, so pin it. */
const at = (instant) => vi.setSystemTime(instant);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  at(NOW);
});

// ── §10 · the boundary matrix ────────────────────────────────────────────────
describe('B5-01F · §10 — the freshness boundary, day by day', () => {
  const CASES = [
    ['Aug 26', 0, 'eligible'],
    ['Aug 25', 1, 'eligible'],
    ['Aug 24', 2, 'eligible'],
    ['Aug 23', 3, 'eligible'],   // INCLUSIVE — the ruling's exact edge
    ['Aug 22', 4, 'stale'],
    ['Jul 15', 42, 'stale'],
    ['Jan 25', 213, 'stale'],
  ];

  it.each(CASES)('%s (age %i) → %s', async (_label, ageDays, expected) => {
    arrange([snap({ ageDays })]);
    const { campaigns, staleEvidence, noCanonicalWindow } = await getCanonicalVerdictCampaigns(WS);

    if (expected === 'eligible') {
      expect(campaigns).toHaveLength(1);
      expect(staleEvidence).toEqual([]);
    } else {
      expect(campaigns).toEqual([]);
      expect(staleEvidence).toHaveLength(1);
      expect(staleEvidence[0].reason).toBe(CANONICAL_EVIDENCE_STALE);
      expect(staleEvidence[0].measurementAgeDays).toBe(ageDays);
    }
    // Never the wrong absence, in either direction.
    expect(noCanonicalWindow).toEqual([]);
  });

  it('the threshold is the ruling, 3, and it is INCLUSIVE', () => {
    expect(MAX_CANONICAL_EVIDENCE_AGE_DAYS).toBe(3);
    expect(measurementAgeDays(new Date('2026-08-23T00:00:00Z'), NOW)).toBe(3);
    expect(measurementAgeDays(new Date('2026-08-22T00:00:00Z'), NOW)).toBe(4);
  });
});

// ── §10 · provider timestamp precision must not move the boundary ────────────
describe('B5-01F · §10 — time of day cannot change the answer', () => {
  const HOURS = ['00:01', '11:59', '12:01', '23:59'];

  it.each(HOURS)('a 3-day-old window ending at %sZ is still eligible', async (endHour) => {
    arrange([snap({ ageDays: 3, endHour })]);
    const { campaigns, staleEvidence } = await getCanonicalVerdictCampaigns(WS);
    expect(campaigns).toHaveLength(1);
    expect(staleEvidence).toEqual([]);
  });

  it.each(HOURS)('a 4-day-old window ending at %sZ is still stale', async (endHour) => {
    arrange([snap({ ageDays: 4, endHour })]);
    const { campaigns, staleEvidence } = await getCanonicalVerdictCampaigns(WS);
    expect(campaigns).toEqual([]);
    expect(staleEvidence[0].reason).toBe(CANONICAL_EVIDENCE_STALE);
  });

  it.each(HOURS)('the EVALUATION hour %sZ does not move the boundary either', async (nowHour) => {
    at(new Date(`2026-08-26T${nowHour}:00.000Z`));
    arrange([snap({ ageDays: 3 })]);
    const { campaigns } = await getCanonicalVerdictCampaigns(WS);
    expect(campaigns).toHaveLength(1);
  });
});

// ── §11 Tests 1–5 ────────────────────────────────────────────────────────────
describe('B5-01F · §11 Test 1 — fresh evidence is untouched', () => {
  it('reaches the campaigns population with its metrics intact', async () => {
    arrange([snap({ ageDays: 0, spendMinor: 999_000 })]);
    const { campaigns } = await getCanonicalVerdictCampaigns(WS);

    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].spendMinor).toBe(999_000);
    expect(campaigns[0].evidenceBasis.reduction).toBe('canonical-resolved-per-entity');
  });
});

describe('B5-01F · §11 Test 4/5 — stale and missing never collapse', () => {
  it('Test 4 · a stale campaign is NOT reported as NO_CANONICAL_WINDOW', async () => {
    arrange([snap({ ageDays: 213 })]);
    const { noCanonicalWindow, staleEvidence } = await getCanonicalVerdictCampaigns(WS);

    expect(noCanonicalWindow).toEqual([]);
    expect(staleEvidence).toHaveLength(1);
    expect(staleEvidence[0].reason).not.toBe(NO_CANONICAL_WINDOW);
    // It reports the facts that explain the gate, so no consumer recomputes them.
    expect(staleEvidence[0]).toMatchObject({ id: 'c1', name: 'Always On', maxAgeDays: 3 });
    expect(staleEvidence[0].windowEnd).toBeInstanceOf(Date);
  });

  it('Test 5 · a campaign with NO canonical row is still NO_CANONICAL_WINDOW', async () => {
    arrange([]);
    const { noCanonicalWindow, staleEvidence } = await getCanonicalVerdictCampaigns(WS);

    expect(staleEvidence).toEqual([]);
    expect(noCanonicalWindow).toHaveLength(1);
    expect(noCanonicalWindow[0].reason).toBe(NO_CANONICAL_WINDOW);
  });

  it('the two reasons are different strings — the distinction is not cosmetic', () => {
    expect(CANONICAL_EVIDENCE_STALE).toBe('CANONICAL_EVIDENCE_STALE');
    expect(CANONICAL_EVIDENCE_STALE).not.toBe(NO_CANONICAL_WINDOW);
  });
});

// ── §11 Test 6 — structural rejection is untouched ───────────────────────────
describe('B5-01F · §11 Test 6 — B5-01E structural semantics are unchanged', () => {
  const structural = (over) => ({ ...snap({ ageDays: 0 }), ...over });

  it('a structurally invalid row is still NO_CANONICAL_WINDOW, not stale', async () => {
    // Missing period — rejected by the resolver, so it never reaches the gate.
    arrange([structural({ windowStart: null, windowEnd: null })]);
    const { campaigns, noCanonicalWindow, staleEvidence } = await getCanonicalVerdictCampaigns(WS);

    expect(campaigns).toEqual([]);
    expect(staleEvidence).toEqual([]);
    expect(noCanonicalWindow[0].reason).toBe(NO_CANONICAL_WINDOW);
  });

  it('a FRESH but non-canonical declaration is still rejected structurally', async () => {
    arrange([structural({ measurementWindow: 'ROLLING_WINDOW' })]);
    const { campaigns, noCanonicalWindow, staleEvidence } = await getCanonicalVerdictCampaigns(WS);

    expect(campaigns).toEqual([]);
    expect(staleEvidence).toEqual([]);
    expect(noCanonicalWindow).toHaveLength(1);
  });

  it('the structural rejection vocabulary gained nothing', () => {
    expect(Object.values(REJECTION)).toEqual([
      'NOT_CANONICAL', 'MISSING_PERIOD', 'MALFORMED_PERIOD', 'FUTURE_PERIOD', 'PROVENANCE_MISMATCH',
    ]);
    expect(Object.values(REJECTION)).not.toContain(CANONICAL_EVIDENCE_STALE);
  });
});

// ── §11 Test 8 — a mixed population does not collapse ────────────────────────
describe('B5-01F · §11 Test 8 — fresh, stale and missing coexist', () => {
  it('each campaign gets its own answer', async () => {
    arrange(
      [snap({ entityId: 'A', ageDays: 1 }), snap({ entityId: 'B', ageDays: 90 })],
      [identity('A', 'Fresh'), identity('B', 'Stale'), identity('C', 'Never measured')],
    );

    const { campaigns, staleEvidence, noCanonicalWindow } = await getCanonicalVerdictCampaigns(WS);

    expect(campaigns.map((c) => c.entityId)).toEqual(['A']);
    expect(staleEvidence.map((c) => c.id)).toEqual(['B']);
    expect(noCanonicalWindow.map((c) => c.id)).toEqual(['C']);
  });

  it('one stale campaign does not gate out the fresh ones beside it', async () => {
    arrange(
      [snap({ entityId: 'A', ageDays: 0 }), snap({ entityId: 'B', ageDays: 400 }), snap({ entityId: 'C', ageDays: 3 })],
      [identity('A'), identity('B'), identity('C')],
    );

    const { campaigns, staleEvidence } = await getCanonicalVerdictCampaigns(WS);
    expect(campaigns.map((c) => c.entityId).sort()).toEqual(['A', 'C']);
    expect(staleEvidence.map((c) => c.id)).toEqual(['B']);
  });
});

// ── §11 Test 9 — B5-01E resolution still decides WHICH row ───────────────────
describe('B5-01F · §11 Test 9 — freshness runs AFTER resolution, never instead of it', () => {
  it('the resolver still picks the newest MEASURED period, and that row is then judged for age', async () => {
    arrange([
      // Older period, synced most recently — the row `date` ranking would pick.
      snap({ ageDays: 200, syncedAt: NOW, spendMinor: 111 }),
      // Newer period, synced earlier — the correct selection, and it is fresh.
      snap({ ageDays: 1, syncedAt: new Date(NOW.getTime() - 5 * DAY), spendMinor: 999 }),
    ]);

    const { campaigns, staleEvidence } = await getCanonicalVerdictCampaigns(WS);

    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].spendMinor).toBe(999);
    expect(staleEvidence).toEqual([]);
  });

  it('when the resolver’s winner is stale, the campaign gates out — no falling back to a runner-up', async () => {
    arrange([
      snap({ ageDays: 50, spendMinor: 111 }),
      snap({ ageDays: 300, spendMinor: 222 }),
    ]);

    const { campaigns, staleEvidence } = await getCanonicalVerdictCampaigns(WS);

    expect(campaigns).toEqual([]);
    expect(staleEvidence).toHaveLength(1);
    // The AGE of the resolver's winner (the newest period), not of the other row.
    expect(staleEvidence[0].measurementAgeDays).toBe(50);
  });
});

// ── §11 Test 10 — THE SYNC-TIME TRAP ─────────────────────────────────────────
describe('B5-01F · §11 Test 10 — re-syncing old data does not make it fresh', () => {
  it('a row synced TODAY measuring JANUARY is stale', async () => {
    // date = now (synced seconds ago), windowEnd = January. This is exactly what
    // a backfill or a re-sync of an old period produces.
    arrange([snap({ ageDays: 213, syncedAt: NOW })]);

    const { campaigns, staleEvidence } = await getCanonicalVerdictCampaigns(WS);

    expect(campaigns).toEqual([]);
    expect(staleEvidence[0].reason).toBe(CANONICAL_EVIDENCE_STALE);
    expect(staleEvidence[0].measurementAgeDays).toBe(213);
  });

  it('conversely, a row synced LONG AGO measuring a recent period is fresh', async () => {
    // The mirror image, and the reason `date` cannot be the freshness clock in
    // either direction: an old sync timestamp does not age the measurement.
    arrange([snap({ ageDays: 1, syncedAt: new Date('2026-01-01T00:00:00Z') })]);

    const { campaigns, staleEvidence } = await getCanonicalVerdictCampaigns(WS);
    expect(campaigns).toHaveLength(1);
    expect(staleEvidence).toEqual([]);
  });
});

// ── the partition contract, directly ─────────────────────────────────────────
describe('B5-01F · the partition returns three buckets', () => {
  it('splits fresh / stale / absent from one identity list', () => {
    const fresh = snap({ entityId: 'A', ageDays: 0 });
    const old = snap({ entityId: 'B', ageDays: 99 });
    const evidence = new Map([['A', fresh], ['B', old]]);

    const { withEvidence, absent, stale } = partitionByCanonicalEvidence(
      [identity('A'), identity('B'), identity('C')], evidence, { now: NOW },
    );

    expect(withEvidence.map((w) => w.identity.id)).toEqual(['A']);
    expect(stale.map((s) => s.id)).toEqual(['B']);
    expect(absent.map((a) => a.id)).toEqual(['C']);
  });

  it('an UNPROVABLE age is gated, never assumed fresh', () => {
    // Belt-and-braces: a row with no windowEnd cannot survive B5-01E resolution,
    // so this is unreachable in production. If it ever were reachable, "we cannot
    // say how old this is" must not resolve to "current".
    const evidence = new Map([['A', { ...snap({ entityId: 'A' }), windowEnd: null }]]);
    const { withEvidence, stale } = partitionByCanonicalEvidence([identity('A')], evidence, { now: NOW });

    expect(withEvidence).toEqual([]);
    expect(stale[0].reason).toBe(CANONICAL_EVIDENCE_STALE);
    expect(stale[0].measurementAgeDays).toBeNull();
  });
});

// ── §15 · ratchets (comments stripped) ───────────────────────────────────────
describe('B5-01F · §15 source ratchets', () => {
  it('the freshness gate reads windowEnd, and the sync timestamp is not its clock', () => {
    const code = strip(EVIDENCE);
    expect(code).toMatch(/measurementAgeDays\(\s*snapshot\.windowEnd/);
    expect(code).not.toMatch(/measurementAgeDays\(\s*snapshot\.date/);
  });

  it('the gate lives at the partition, not inside structural eligibility', () => {
    const structural = strip(readFileSync(fileURLToPath(new URL('../verdict-engine/metricWindow.js', import.meta.url)), 'utf8'));
    // canonicalEligibility must not consult the freshness contract: a row's
    // structural validity may not change with the evaluation date.
    const eligibilityBody = structural.slice(
      structural.indexOf('export function canonicalEligibility'),
      structural.indexOf('export function resolveCanonicalSnapshot'),
    );
    expect(eligibilityBody).not.toMatch(/MAX_CANONICAL_EVIDENCE_AGE_DAYS|measurementAgeDays/);
  });

  it('the reader shares ONE evaluation instant between resolution and freshness', () => {
    const code = strip(GRAPH);
    // Resolved once — from the caller's instant when given, the wall clock
    // otherwise — and then shared. Two independent reads could land either side
    // of midnight and answer about different days.
    expect(code).toMatch(/const now = nowArg \?\? new Date\(\);/);
    expect(code).toMatch(/resolveCanonicalVerdictByEntity\(rows,\s*\{\s*now\s*\}\)/);
    expect(code).toMatch(/partitionByCanonicalEvidence\(identities,\s*selected,\s*\{\s*now\s*\}\)/);
  });
});


// Synthetic immutable capture results at the actual observation-query seam.
// These are unit fixtures, not authority for legacy database snapshots.
const captured = (rows, workspaceId = WS) => rows.map((row, index) => {
  const committedProjection = { formatVersion: 1,
    snapshot: JSON.parse(JSON.stringify({ ...row, workspaceId, entityLevel: 'CAMPAIGN' })),
    attributes: { objective: 'OUTCOME_SALES' } };
  const day = (v) => v == null ? null : new Date(v).toISOString().slice(0, 10);
  const sourceFacts = { binding: 'EXACT', providerAccountId: 'act_unit',
    rawDates: { start: { presence: row.windowStart ? 'VALID' : 'MISSING', value: day(row.windowStart) },
      stop: { presence: row.windowEnd ? 'VALID' : 'MISSING', value: day(row.windowEnd) } },
    metricFields: { spend: 'VALID', impressions: 'VALID', clicks: 'VALID', revenue: 'VALID', conversions: 'VALID', frequency: 'VALID' } };
  const id = (n) => '10000000-0000-4000-8000-' + String(index * 4 + n).padStart(12, '0');
  return { workspaceId, entityId: row.entityId, observationId: id(1), refreshId: id(2),
    sourceAttemptId: id(3), writeId: id(4), committedProjection, sourceFacts,
    contentHash: canonicalContentHash({ projection: committedProjection, facts: sourceFacts }).toString('hex'),
    sourceScope: { providerAccountId: 'act_unit' }, sourceReceipt: { outcome: 'EXHAUSTED' } };
});

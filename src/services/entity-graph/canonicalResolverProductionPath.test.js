// ============================================================
// B5-01E · F-3A / F-4 — the resolver is the PRODUCTION verdict selector
// ============================================================
// F-4 was "the correct resolver exists and has zero production callers". A test
// that imports resolveCanonicalSnapshot and asserts it works would leave that
// exactly as true as it was. So every selection test in this file runs through
// getCanonicalVerdictCampaigns — the real verdict evidence entry point — and the
// mutation controls bypass the resolver at the seam to prove these fail.
//
// F-3A is the defect that made it urgent: `latestCanonicalByEntity` ranked
// candidates on `date`, the SYNC TIMESTAMP. Re-syncing an older canonical period
// stamps it with a newer `date`, so the stale measurement won and decided the
// verdict. Proven on trunk before the fix: ranking by `date` selected a
// June–July window over a July–August one for the same campaign.
//
// WHAT THIS SUITE DELIBERATELY DOES NOT CLAIM
// --------------------------------------------
// Structural validity is not freshness. The last describe block pins a
// structurally valid JANUARY window being accepted in AUGUST, on purpose, so no
// later report can cite resolver activation as having closed F-13 / F-3B.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { campaign: { findMany: vi.fn() }, metricSnapshot: { findMany: vi.fn() } },
}));
vi.mock('../evidence/index.js', () => ({ selectOperationalSnapshots: vi.fn(async () => []) }));

import { prisma } from '../../lib/prisma.js';
import { getCanonicalVerdictCampaigns } from './EntityGraphService.js';
import {
  CanonicalEvidenceUnavailableError, CANONICAL_EVIDENCE_READ_FAILED,
  resolveCanonicalVerdictByEntity,
} from '../verdict-engine/canonicalVerdictEvidence.js';
import { REJECTION, CANONICAL_VERDICT_WINDOW_DAYS } from '../verdict-engine/metricWindow.js';
import { EVIDENCE_REDUCTION } from '../verdict-engine/evidenceReference.js';

const GRAPH = readFileSync(fileURLToPath(new URL('./EntityGraphService.js', import.meta.url)), 'utf8');
const EVIDENCE = readFileSync(fileURLToPath(new URL('../verdict-engine/canonicalVerdictEvidence.js', import.meta.url)), 'utf8');
/** Comments stripped — both files DISCUSS the old selector by name to explain
 *  why it was replaced, and a ratchet that cannot tell prose from a call fires
 *  on its own documentation. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const WS = 'ws-e';
const C1 = 'c1';

const identity = (id = C1, name = 'Always On') => ({
  id, name, channel: 'META', objective: 'OUTCOME_SALES',
  externalId: `ext-${id}`, platformCreatedTime: new Date('2026-01-01T00:00:00Z'),
  _count: { adSets: 1 },
});

/** A canonical candidate. `period` is [startISO, endISO]; `syncedAt` is `date`. */
const candidate = ({ entityId = C1, period, syncedAt, spendMinor = 100, window = 'CUMULATIVE_30D' }) => ({
  entityId, source: 'META', currency: 'USD',
  measurementWindow: window,
  windowStart: period?.[0] ? new Date(period[0]) : null,
  windowEnd:   period?.[1] ? new Date(period[1]) : null,
  date: new Date(syncedAt),
  spendMinor, revenueMinor: spendMinor * 3, impressions: 1000, clicks: 20,
  conversions: 5, roas: 3, ctr: 0.02, frequency: 2, reach: 500,
  actionMetrics: null, dailyBudgetMinor: null,
});

// A real 30-day period: 2026-07-13 → 2026-08-11 inclusive.
const JUL_AUG = ['2026-07-13T00:00:00Z', '2026-08-11T00:00:00Z'];
// An earlier real 30-day period: 2026-06-13 → 2026-07-12 inclusive.
const JUN_JUL = ['2026-06-13T00:00:00Z', '2026-07-12T00:00:00Z'];

const arrange = (rows, identities = [identity()]) => {
  prisma.campaign.findMany.mockResolvedValue(identities);
  prisma.metricSnapshot.findMany.mockResolvedValue(rows);
};

beforeEach(() => { vi.clearAllMocks(); });

// ── §12 · the resolver is genuinely on the production path ───────────────────
describe('B5-01E · §12 — the production verdict path invokes the resolver', () => {
  it('a structurally valid row is selected and carries the resolved provenance', async () => {
    arrange([candidate({ period: JUL_AUG, syncedAt: '2026-08-11T09:00:00Z', spendMinor: 999 })]);

    const { campaigns, noCanonicalWindow } = await getCanonicalVerdictCampaigns(WS);

    expect(noCanonicalWindow).toEqual([]);
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].spendMinor).toBe(999);
    // The provenance names the reduction that actually happened.
    expect(campaigns[0].evidenceBasis.reduction).toBe(EVIDENCE_REDUCTION.CANONICAL_RESOLVED_PER_ENTITY);
    expect(campaigns[0].evidenceBasis.reduction).not.toBe(EVIDENCE_REDUCTION.LATEST_PER_ENTITY);
  });

  it('rowCount still reports candidates CONSUMED, not the one selected', async () => {
    arrange([
      candidate({ period: JUN_JUL, syncedAt: '2026-08-11T09:00:00Z' }),
      candidate({ period: JUL_AUG, syncedAt: '2026-08-10T09:00:00Z' }),
    ]);

    const { campaigns } = await getCanonicalVerdictCampaigns(WS);
    expect(campaigns[0].evidenceBasis.rowCount).toBe(2);
  });
});

// ── §11 · wrong-row selection ────────────────────────────────────────────────
describe('B5-01E · §11 Test A — re-sync promotion (THE F-3A DEFECT)', () => {
  it('the newer MEASUREMENT wins, even though the older one was synced later', async () => {
    arrange([
      // The stale period, re-synced today → newest `date`. The old selector's winner.
      candidate({ period: JUN_JUL, syncedAt: '2026-08-11T09:00:00Z', spendMinor: 111 }),
      // The current period, synced days ago → older `date`. The correct answer.
      candidate({ period: JUL_AUG, syncedAt: '2026-08-08T09:00:00Z', spendMinor: 999 }),
    ]);

    const { campaigns } = await getCanonicalVerdictCampaigns(WS);

    expect(campaigns[0].spendMinor).toBe(999);
    expect(campaigns[0].spendMinor).not.toBe(111); // what `date` ranking returned
    expect(campaigns[0].windowEnd.toISOString()).toBe('2026-08-11T00:00:00.000Z');
  });

  it('`date` still breaks an exact tie between two identical periods', async () => {
    arrange([
      candidate({ period: JUL_AUG, syncedAt: '2026-08-09T09:00:00Z', spendMinor: 1 }),
      candidate({ period: JUL_AUG, syncedAt: '2026-08-11T09:00:00Z', spendMinor: 2 }),
    ]);

    const { campaigns } = await getCanonicalVerdictCampaigns(WS);
    expect(campaigns[0].spendMinor).toBe(2);
  });
});

describe('B5-01E · §11 Test B — newer malformed, older valid', () => {
  it('the older VALID candidate is selected, not the newer malformed one', async () => {
    arrange([
      // Newer sync AND newer window, but the span is 31 days — not canonical.
      candidate({ period: ['2026-07-12T00:00:00Z', '2026-08-11T00:00:00Z'], syncedAt: '2026-08-11T09:00:00Z', spendMinor: 111 }),
      candidate({ period: JUN_JUL, syncedAt: '2026-07-12T09:00:00Z', spendMinor: 999 }),
    ]);

    const { campaigns } = await getCanonicalVerdictCampaigns(WS);
    expect(campaigns[0].spendMinor).toBe(999);
  });
});

describe('B5-01E · §11 Tests C–E — structural rejections', () => {
  it('C · a candidate with no period is rejected (MISSING_PERIOD)', () => {
    const rows = [candidate({ period: null, syncedAt: '2026-08-11T09:00:00Z' })];
    const { selected, rejected } = resolveCanonicalVerdictByEntity(rows, { now: new Date('2026-08-11T12:00:00Z') });

    expect(selected.size).toBe(0);
    expect(rejected.get(C1)[0].reason).toBe(REJECTION.MISSING_PERIOD);
  });

  it('D · a period that contradicts the declaration is rejected (PROVENANCE_MISMATCH)', () => {
    const rows = [candidate({ period: ['2026-08-01T00:00:00Z', '2026-08-07T00:00:00Z'], syncedAt: '2026-08-11T09:00:00Z' })];
    const { selected, rejected } = resolveCanonicalVerdictByEntity(rows, { now: new Date('2026-08-11T12:00:00Z') });

    expect(selected.size).toBe(0);
    expect(rejected.get(C1)[0].reason).toBe(REJECTION.PROVENANCE_MISMATCH);
  });

  it('E · a period ending on a later DAY than now is rejected (FUTURE_PERIOD)', () => {
    const rows = [candidate({ period: ['2026-08-14T00:00:00Z', '2026-09-12T00:00:00Z'], syncedAt: '2026-08-11T09:00:00Z' })];
    const { selected, rejected } = resolveCanonicalVerdictByEntity(rows, { now: new Date('2026-08-11T12:00:00Z') });

    expect(selected.size).toBe(0);
    expect(rejected.get(C1)[0].reason).toBe(REJECTION.FUTURE_PERIOD);
  });

  it('a non-canonical declaration is rejected however well its dates line up', () => {
    const rows = [candidate({ period: JUL_AUG, syncedAt: '2026-08-11T09:00:00Z', window: 'ROLLING_WINDOW' })];
    const { selected, rejected } = resolveCanonicalVerdictByEntity(rows, { now: new Date('2026-08-11T12:00:00Z') });

    expect(selected.size).toBe(0);
    expect(rejected.get(C1)[0].reason).toBe(REJECTION.NOT_CANONICAL);
  });
});

describe('B5-01E · §11 Test F — every candidate invalid', () => {
  it('the campaign reports NO_CANONICAL_WINDOW and NEVER the newest raw row', async () => {
    arrange([
      candidate({ period: null, syncedAt: '2026-08-11T09:00:00Z', spendMinor: 111 }),
      candidate({ period: ['2026-08-01T00:00:00Z', '2026-08-07T00:00:00Z'], syncedAt: '2026-08-10T09:00:00Z', spendMinor: 222 }),
    ]);

    const { campaigns, noCanonicalWindow } = await getCanonicalVerdictCampaigns(WS);

    expect(campaigns).toEqual([]);
    expect(noCanonicalWindow).toHaveLength(1);
    expect(noCanonicalWindow[0]).toMatchObject({ id: C1, reason: 'NO_CANONICAL_WINDOW' });
  });

  it('one campaign resolving does not rescue another whose candidates are all invalid', async () => {
    arrange(
      [
        candidate({ entityId: C1, period: JUL_AUG, syncedAt: '2026-08-11T09:00:00Z', spendMinor: 999 }),
        candidate({ entityId: 'c2', period: null, syncedAt: '2026-08-11T09:00:00Z', spendMinor: 111 }),
      ],
      [identity(C1), identity('c2', 'Broken')],
    );

    const { campaigns, noCanonicalWindow } = await getCanonicalVerdictCampaigns(WS);

    expect(campaigns.map((c) => c.entityId)).toEqual([C1]);
    expect(noCanonicalWindow.map((c) => c.id)).toEqual(['c2']);
  });
});

// ── §16 · B5-01B must stay closed ────────────────────────────────────────────
describe('B5-01E · §16 — the canonical READ FAILURE contract is untouched', () => {
  it('a failed evidence read still throws, and is not turned into NO_CANONICAL_WINDOW', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity()]);
    prisma.metricSnapshot.findMany.mockImplementation(() => Promise.reject(new Error('connection terminated')));

    const err = await getCanonicalVerdictCampaigns(WS).catch((e) => e);

    expect(err).toBeInstanceOf(CanonicalEvidenceUnavailableError);
    expect(err.code).toBe(CANONICAL_EVIDENCE_READ_FAILED);
    expect(err.campaigns).toBeUndefined();
    expect(err.noCanonicalWindow).toBeUndefined();
  });

  it('the resolver runs only AFTER a successful read — a failure never reaches it', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity()]);
    prisma.metricSnapshot.findMany.mockImplementation(() => Promise.reject(new Error('down')));

    await getCanonicalVerdictCampaigns(WS).catch(() => {});
    // Nothing resolved, nothing partitioned, nothing published.
    expect(prisma.metricSnapshot.findMany).toHaveBeenCalledTimes(1);
  });

  it('a genuinely empty canonical population is still an honest absence', async () => {
    arrange([]);
    const { campaigns, noCanonicalWindow } = await getCanonicalVerdictCampaigns(WS);

    expect(campaigns).toEqual([]);
    expect(noCanonicalWindow).toHaveLength(1);
    expect(noCanonicalWindow[0].reason).toBe('NO_CANONICAL_WINDOW');
  });
});

// ── §14 · THE FRESHNESS GUARD — this slice does NOT close F-13 / F-3B ────────
describe('B5-01E · §14 — a STRUCTURALLY VALID row is accepted however old it is', () => {
  it('a January window is ACCEPTED STRUCTURALLY in August — this is NOT a freshness claim', async () => {
    // 2026-01-01 → 2026-01-30 inclusive: a real, well-formed canonical period,
    // seven months stale. It is accepted, and that is the CURRENT CONTRACT.
    arrange([candidate({ period: ['2026-01-01T00:00:00Z', '2026-01-30T00:00:00Z'], syncedAt: '2026-01-30T09:00:00Z', spendMinor: 777 })]);

    const { campaigns, noCanonicalWindow } = await getCanonicalVerdictCampaigns(WS);

    // ACCEPTED STRUCTURALLY. Deliberately not called "fresh", "current", or
    // "valid evidence for a verdict today" — B5-01E resolves WHICH row, never
    // WHETHER a measurement is recent enough to support a verdict. That question
    // is F-13 / F-3B and needs a product ruling, not an implementation slice.
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].spendMinor).toBe(777);
    expect(noCanonicalWindow).toEqual([]);
  });

  it('between two structurally valid rows, staleness is not a tie-break either', async () => {
    arrange([
      candidate({ period: ['2026-01-01T00:00:00Z', '2026-01-30T00:00:00Z'], syncedAt: '2026-08-11T09:00:00Z', spendMinor: 111 }),
      candidate({ period: JUL_AUG, syncedAt: '2026-08-08T09:00:00Z', spendMinor: 999 }),
    ]);

    // The recent one wins here because its windowEnd is LATER, not because the
    // other was judged stale. Nothing in this slice knows what "too old" means.
    const { campaigns } = await getCanonicalVerdictCampaigns(WS);
    expect(campaigns[0].spendMinor).toBe(999);
  });

  it('NO FRESHNESS THRESHOLD EXISTS IN THE IMPLEMENTATION', () => {
    const code = strip(EVIDENCE) + strip(GRAPH);
    expect(code).not.toMatch(/MAX_CANONICAL_AGE|STALE_AFTER|maxAgeDays|freshnessDays|CANONICAL_TTL/);
    // The only day constant the canonical contract may hold is the window itself.
    expect(CANONICAL_VERDICT_WINDOW_DAYS).toBe(30);
  });
});

// ── §18 · architecture ratchets (comments stripped) ──────────────────────────
describe('B5-01E · §18 source ratchets', () => {
  it('the production verdict selector is the resolver, not latestCanonicalByEntity', () => {
    const code = strip(GRAPH);
    expect(code).toMatch(/resolveCanonicalVerdictByEntity\s*\(/);
    expect(code).not.toMatch(/latestCanonicalByEntity\s*\(/);
  });

  it('the resolver-backed reduction delegates to resolveCanonicalSnapshot rather than reimplementing it', () => {
    const code = strip(EVIDENCE);
    expect(code).toMatch(/resolveCanonicalSnapshot\s*\(/);
    // No second ordering rule: nothing here may rank candidates on `date`.
    expect(code).not.toMatch(/sort\([^)]*\bdate\b/);
  });

  it('the canonical evidence basis advertises the resolved reduction', () => {
    expect(strip(EVIDENCE)).toMatch(/reduction:\s*EVIDENCE_REDUCTION\.CANONICAL_RESOLVED_PER_ENTITY/);
  });
});

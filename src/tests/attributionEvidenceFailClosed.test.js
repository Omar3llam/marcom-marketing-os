// ============================================================
// B5-01T′ — the decision path fails closed on unavailable attribution evidence
// ============================================================
// The companion to the service-level tests, and deliberately not a duplicate of
// them. ReconciliationService.test.js proves incrementalChannels() throws; this
// file proves the throw SURVIVES THE CHAIN — through the lazy dynamic import in
// AllocationService, past the allocation engine, out of previewAllocation, and
// into the shape a route can act on.
//
// WHY THAT IS A SEPARATE TEST. The refusal is only worth anything if nothing
// between the read and the caller swallows it. A single `.catch(() => [])` in
// buildIncrementalChannels — the exact pattern this slice exists to remove —
// would turn the refusal back into a plan, and every service-level assertion
// would still pass. So the subject here is the BOUNDARY, and the boundary is
// therefore not mocked: ReconciliationService and AllocationService both run for
// real. Only the two leaves are stubbed — the database, and blended truth.
//
// THE ASYMMETRY UNDER TEST (B5-01T′ · I4)
// ---------------------------------------
//   basis: 'blended'      never asks for attribution → unaffected, still plans
//   basis: 'incremental'  asks for MEASURED efficiency → a dead read refuses
//
// That asymmetry is not invented here. `basis` already existed as the caller's
// declaration of which evidence the decision needs; this slice only makes the
// declaration mean something when the evidence cannot be read.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// Spend-window slice: previewAllocation now also reads the governed period's
// spend, through the Evidence seam and BlendedTruth's own latestPerStream. That
// read is a DATABASE leaf, so it is stubbed like the others (no rows → the
// period is NOT_MEASURABLE); the real BlendedTruth helpers are kept. None of the
// assertions below changes — the refusal still happens before the spend read.
vi.mock('../services/blended-truth/BlendedTruthService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getBlendedTruth: vi.fn(),
}));
vi.mock('../services/evidence/index.js', async (importOriginal) => ({
  ...(await importOriginal()),
  selectOperationalSnapshots: vi.fn(async () => []),
}));
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    incrementalityTest: { findMany: vi.fn() },
    decision:           { findMany: vi.fn() },
  },
}));

import { prisma } from '../lib/prisma.js';
import { getBlendedTruth } from '../services/blended-truth/BlendedTruthService.js';
import { previewAllocation } from '../services/allocation-engine/AllocationService.js';

const WS = 'ws-t-prime';

const CHANNELS = [
  { channelId: 'meta',   channel: 'META',   platformRevenueMinor: 300_000, blendedRevenueMinor: 240_000,
    spendMinor: 100_000, blendedRoas: 2.4, currency: 'USD', coverage: 'RECONCILED' },
  { channelId: 'google', channel: 'GOOGLE', platformRevenueMinor: 120_000, blendedRevenueMinor: 100_000,
    spendMinor: 100_000, blendedRoas: 1.0, currency: 'USD', coverage: 'RECONCILED' },
];

const blendedTruth = {
  channels: CHANNELS,
  portfolio: {
    spendMinor: 200_000, platformRevenueMinor: 420_000, blendedRevenueMinor: 340_000,
    gapMinor: 80_000, gapPct: 19,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  getBlendedTruth.mockResolvedValue(blendedTruth);
  prisma.incrementalityTest.findMany.mockResolvedValue([]);
  prisma.decision.findMany.mockResolvedValue([]);
});

describe('B5-01T′ · allocation refuses rather than substituting evidence', () => {
  // ── T7 · the refusal reaches the caller ──────────────────────────────────
  it('T7 — a failed holdout read refuses the incremental allocation, machine-readably', async () => {
    prisma.incrementalityTest.findMany.mockRejectedValue(new Error('db down'));

    const err = await previewAllocation(WS, { totalBudgetMinor: 500_000, basis: 'incremental' })
      .then(() => null, (e) => e);

    expect(err, 'a plan was produced from evidence that could not be read').toBeTruthy();
    expect(err.code).toBe('ATTRIBUTION_EVIDENCE_UNAVAILABLE');
    expect(err.reason).toBe('INCREMENTALITY_EVIDENCE_UNAVAILABLE');
    // The message has to be actionable at a glance in a log line — an operator
    // reading it should learn what was refused and why, not just that something
    // was unavailable.
    expect(err.message).toMatch(/refusing rather than falling back/);
  });

  // ── T9 · and no plan exists to act on ────────────────────────────────────
  it('T9 — no allocation output survives a failed read, on any basis it was asked for', async () => {
    prisma.incrementalityTest.findMany.mockRejectedValue(new Error('db down'));

    const out = await previewAllocation(WS, { totalBudgetMinor: 500_000, basis: 'incremental' })
      .then((plan) => ({ plan }), (e) => ({ err: e }));

    // The specific thing that must not happen: a plan whose moves exist only
    // because `basis: 'blended'` and `anyIncremental: false` were substituted
    // for a measurement nobody could take.
    expect(out.plan).toBeUndefined();
    expect(out.err).toBeTruthy();
    expect(out.err.code).toBe('ATTRIBUTION_EVIDENCE_UNAVAILABLE');
  });

  // ── T8 · successful absence is still allowed to allocate ─────────────────
  it('T8 — a SUCCESSFUL empty holdout read still produces a plan on the blended basis', async () => {
    // If this failed, the refusal above would have broken the feature instead of
    // making it honest. "This account has run no holdouts" is a real answer.
    prisma.incrementalityTest.findMany.mockResolvedValue([]);

    const plan = await previewAllocation(WS, { totalBudgetMinor: 500_000, basis: 'incremental' });

    expect(plan).toBeTruthy();
    expect(plan.basis).toBe('incremental');
    expect(plan.totalBudgetMinor).toBe(500_000);
  });

  // ── the untouched half ───────────────────────────────────────────────────
  it('the blended basis never asked for attribution, and is unaffected by its failure', async () => {
    // The scope boundary, asserted rather than asserted-in-prose. `basis:
    // 'blended'` is the default and the only basis any route can currently
    // request; it does not read holdouts at all, so a dead holdout table must
    // not take the ordinary allocation path down with it.
    prisma.incrementalityTest.findMany.mockRejectedValue(new Error('db down'));

    const plan = await previewAllocation(WS, { totalBudgetMinor: 500_000 });

    expect(plan).toBeTruthy();
    expect(plan.basis).toBe('blended');
    expect(prisma.incrementalityTest.findMany).not.toHaveBeenCalled();
  });

  it('the refusal is a real error class, not a string sniff', async () => {
    // `err.code` is the contract the route boundary keys on. Asserting the class
    // too means a future refactor cannot satisfy the boundary by throwing a bare
    // Error whose message happens to contain the right words.
    const { AttributionEvidenceUnavailableError } =
      await import('../services/attribution-engine/attributionTypes.js');
    prisma.incrementalityTest.findMany.mockRejectedValue(new Error('db down'));

    await expect(previewAllocation(WS, { totalBudgetMinor: 500_000, basis: 'incremental' }))
      .rejects.toBeInstanceOf(AttributionEvidenceUnavailableError);
  });
});

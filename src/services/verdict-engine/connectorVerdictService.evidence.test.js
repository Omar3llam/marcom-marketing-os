// ============================================================
// R5 — the stored decision's provenance reaches the payload
// ============================================================
// Backend-has-it and API-exposes-it are two different claims, and discovery
// found the product failing the second one everywhere except narratives. This
// file owns the second claim for the verdict feed: what persistNode froze onto
// the Decision has to arrive at the surface a human reads.
//
// It travels BESIDE decisionId and decisionVerdict, about the same stored row —
// never mixed into the live verdict recomputed above it, which is a different
// question (what Lumi thinks now vs what it was looking at then).
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCanonicalVerdictCampaigns, findMany, groupBy } = vi.hoisted(() => ({
  getCanonicalVerdictCampaigns: vi.fn(), findMany: vi.fn(), groupBy: vi.fn(),
}));
vi.mock('../entity-graph/index.js', () => ({ getCanonicalVerdictCampaigns }));
vi.mock('../../lib/prisma.js', () => ({ prisma: { decision: { findMany, groupBy } } }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getConnectorVerdicts } from './connectorVerdictService.js';

const WS = 'ws-1';
const C1 = 'c1';

// A campaign with measured revenue, so it reaches the engine rather than gatedOut.
const campaignRow = (over = {}) => ({
  entityId: C1, name: 'Eid', channel: 'META', objective: 'OUTCOME_SALES',
  spendMinor: 100_000, revenueMinor: 400_000, impressions: 50_000, clicks: 800,
  conversions: 20, frequency: 2.1, roas: 4, ctr: 0.016, currency: 'EGP',
  ...over,
});

// The reference AS STORED — a plain JSON object, exactly as Prisma hands a JSONB
// column back. Written by hand rather than built with toEvidenceReference: this
// test is about carriage, and using the projector here would let the assertion
// agree with the implementation about the shape it is meant to be checking.
const STORED_REFERENCE = Object.freeze({
  population:        'canonical-verdict',
  selector:          'selectCanonicalVerdictSnapshots',
  measurementWindow: 'CUMULATIVE_30D',
  sources:           ['META'],
  observedAt:        ['2026-08-10T09:00:00.000Z'],
  reduction:         'latest-per-entity',
  entityIds:         [C1],
  rowCount:          11,
  refs:              [],
});

const decisionRow = (over = {}) => ({
  id: 'd-1', entityId: C1, verdict: 'KILL',
  createdAt: new Date('2026-08-12T09:00:00Z'),
  evidenceReference: { ...STORED_REFERENCE },
  ...over,
});

const verdictOf = async () => (await getConnectorVerdicts(WS)).verdicts[0];

beforeEach(() => {
  vi.clearAllMocks();
  getCanonicalVerdictCampaigns.mockResolvedValue({ campaigns: [campaignRow()], noCanonicalWindow: [] });
  groupBy.mockResolvedValue([]);
  findMany.mockResolvedValue([]);
});

describe('R5 — the verdict payload carries the stored decision\'s provenance', () => {
  it('projects evidenceReference in the identity read', async () => {
    // It has to be NAMED. A select-less read would pull both reasoning JSONB
    // columns per row to discard them, which is the cost this projection has
    // always been explicit about avoiding.
    await getConnectorVerdicts(WS);
    expect(findMany.mock.calls[0][0].select.evidenceReference).toBe(true);
  });

  it('publishes it verbatim, beside the decision it belongs to', async () => {
    findMany.mockResolvedValue([decisionRow()]);
    const v = await verdictOf();
    expect(v.decisionId).toBe('d-1');
    expect(v.decisionEvidenceReference).toEqual(STORED_REFERENCE);
  });

  it('does not reshape, summarise or re-derive the stored reference', async () => {
    // Whatever was frozen at the decision is what a reader sees. A payload that
    // recomputed any part of it would be answering with today's evidence about
    // a call made against yesterday's.
    findMany.mockResolvedValue([decisionRow()]);
    const v = await verdictOf();
    expect(Object.keys(v.decisionEvidenceReference)).toEqual(Object.keys(STORED_REFERENCE));
    expect(v.decisionEvidenceReference.rowCount).toBe(11);
    expect(v.decisionEvidenceReference.observedAt).toEqual(['2026-08-10T09:00:00.000Z']);
  });

  it('is NULL when the stored decision predates provenance', async () => {
    // Every decision written before R5. null reaches the surface unchanged, so
    // the UI can render nothing rather than an empty evidence block — "we did
    // not capture this" is not the claim "there was no evidence".
    findMany.mockResolvedValue([decisionRow({ evidenceReference: null })]);
    const v = await verdictOf();
    expect(v.decisionId).toBe('d-1');
    expect(v.decisionEvidenceReference).toBeNull();
  });

  it('is NULL when no sweep has stored a decision for this campaign', async () => {
    const v = await verdictOf();
    expect(v.decisionId).toBeNull();
    expect(v.decisionEvidenceReference).toBeNull();
  });

  it('belongs to the STORED decision, not to the live verdict beside it', async () => {
    // The two are deliberately not reconciled here. The live verdict is
    // recomputed from today's canonical rows; the reference describes what the
    // stored decision was looking at when it was made, and the payload publishes
    // both without letting either correct the other.
    findMany.mockResolvedValue([decisionRow({ verdict: 'KILL' })]);
    const v = await verdictOf();
    expect(v.decisionVerdict).toBe('KILL');
    expect(v.verdict).not.toBe(v.decisionVerdict); // the live call has moved on
    expect(v.decisionEvidenceReference.population).toBe('canonical-verdict');
  });

  it('adds nothing to the live verdict fields', async () => {
    // R5 is additive to this payload. Nothing renamed, nothing removed, and no
    // provenance smuggled onto the live verdict, which persists nothing and
    // therefore has none to publish.
    findMany.mockResolvedValue([decisionRow()]);
    const v = await verdictOf();
    expect(v).not.toHaveProperty('evidenceReference');
    expect(v.rationale).toBeTruthy();
    expect(v.rootCause !== undefined).toBe(true);
  });
});

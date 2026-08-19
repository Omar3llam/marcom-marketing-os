// ============================================================
// R13-D / B1 — a verdict payload that can state its own period
// ============================================================
// /entities/verdicts is the primary decision surface's API. It publishes spend,
// ROAS and CTR, and until now it published them with nothing attached that said
// what period they covered. The numbers were right — the canonical selector had
// already pinned them to CUMULATIVE_30D — but the payload could not say so, so
// the only place a period could come from was an assumption on the client.
//
// That assumption is not hypothetical. It is exactly how a ~37-month operational
// aggregate reached a surface captioned "last 30 days": every layer was correct
// about its own numbers and no layer was able to contradict the caption.
//
// WHAT THIS FILE PINS, and the two halves are deliberately separate:
//
//   1. CARRIAGE — the payload repeats what the ROW says. Not the constant the
//      reader asked for, not a period derived from a timestamp, not a default.
//      A projection with no opinion is the only kind that can be checked.
//
//   2. POPULATION — which rows may be read at all is decided upstream, once, by
//      canonicalVerdictEvidence's `where`. This path never re-reads the column
//      to choose a row, and never touches the operational reader.
//
// Keeping them apart is the point. Fold them together — "publish CUMULATIVE_30D
// because the filter guarantees it" — and the API states a belief instead of a
// fact, which is the same shape of claim the caption above was making.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCanonicalVerdictCampaigns, getConnectorCampaigns, findMany, groupBy } = vi.hoisted(() => ({
  getCanonicalVerdictCampaigns: vi.fn(), getConnectorCampaigns: vi.fn(),
  findMany: vi.fn(), groupBy: vi.fn(),
}));

// BOTH readers are mocked, not just the one under test. The operational reader
// is here so its call count can be asserted at zero — a swap back to it is the
// single most damaging regression this slice can suffer, and an unmocked module
// could not tell us it happened.
vi.mock('../entity-graph/index.js', () => ({ getCanonicalVerdictCampaigns, getConnectorCampaigns }));
vi.mock('../../lib/prisma.js', () => ({ prisma: { decision: { findMany, groupBy } } }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getConnectorVerdicts } from './connectorVerdictService.js';
// The REAL projection, not a hand-built row. toCampaignRow + metricsOf is the
// seam between the canonical snapshot and the verdict tree, and building the
// fixture by hand would let this test agree with the implementation about the
// one hop most likely to drop a field.
import { toCampaignRow } from '../entity-graph/entityGraphEngine.js';
import { CANONICAL_VERDICT_EVIDENCE_BASIS, CANONICAL_VERDICT_SELECT } from './canonicalVerdictEvidence.js';

const WS = 'ws-1';
const C1 = 'c1';

// The period is deliberately NOT derivable from anything else on the row:
//   • `date` (the SYNC timestamp) is 19 Aug — outside the window entirely
//   • the window is 20 Jul → 18 Aug, which is neither `date` nor `date − 30d`
// So an implementation that reconstructed the bounds from a timestamp, or
// defaulted them to "the last 30 days", produces different values and fails.
const SYNCED_AT   = new Date('2026-08-19T06:00:00Z');
const WINDOW_START = new Date('2026-07-20T00:00:00Z');
const WINDOW_END   = new Date('2026-08-18T00:00:00Z');

/** A canonical CUMULATIVE_30D campaign snapshot, exactly as the selector returns it. */
const canonicalSnapshot = (over = {}) => ({
  entityId: C1, date: SYNCED_AT, source: 'META', currency: 'EGP',
  spendMinor: 100_000, revenueMinor: 400_000, impressions: 50_000, clicks: 800,
  conversions: 20, roas: 4, ctr: 0.016, frequency: 2.1, reach: 24_000,
  actionMetrics: null, dailyBudgetMinor: null,
  measurementWindow: 'CUMULATIVE_30D',
  windowStart: WINDOW_START,
  windowEnd:   WINDOW_END,
  ...over,
});

/** …projected into a campaign row the way getCanonicalVerdictCampaigns does. */
const campaignRow = (snapOver = {}, identityOver = {}) => toCampaignRow(
  {
    id: C1, name: 'Eid', channel: 'META', objective: 'OUTCOME_SALES',
    externalId: '23851', platformCreatedTime: null, adSetCount: 0, ...identityOver,
  },
  canonicalSnapshot(snapOver),
  { ...CANONICAL_VERDICT_EVIDENCE_BASIS, rowCount: 11 },
);

const mockCampaigns = (rows) =>
  getCanonicalVerdictCampaigns.mockResolvedValue({ campaigns: rows, noCanonicalWindow: [] });

const verdictOf = async () => (await getConnectorVerdicts(WS)).verdicts[0];

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
  groupBy.mockResolvedValue([]);
});

describe('1 — the payload exposes its provenance', () => {
  it('every verdict carries all three fields', async () => {
    mockCampaigns([campaignRow(), campaignRow({}, { id: 'c2', name: 'Ramadan' })]);
    const { verdicts } = await getConnectorVerdicts(WS);

    expect(verdicts).toHaveLength(2);
    for (const v of verdicts) {
      // `toHaveProperty` rather than a truthiness check: the contract is that the
      // key is ALWAYS present. A missing key and a null one are different answers
      // — absent means the API forgot, null means the platform never said — and a
      // client cannot tell them apart from `undefined`.
      expect(v).toHaveProperty('measurementWindow');
      expect(v).toHaveProperty('windowStart');
      expect(v).toHaveProperty('windowEnd');
    }
  });

  it('names the canonical window for a canonical row', async () => {
    mockCampaigns([campaignRow()]);
    expect((await verdictOf()).measurementWindow).toBe('CUMULATIVE_30D');
  });
});

describe('2 — the values are the row\'s own, not a reconstruction', () => {
  it('reports the exact bounds the platform reported', async () => {
    mockCampaigns([campaignRow()]);
    const v = await verdictOf();

    expect(v.windowStart).toEqual(WINDOW_START);
    expect(v.windowEnd).toEqual(WINDOW_END);
  });

  it('does not derive the period from the sync timestamp', async () => {
    mockCampaigns([campaignRow()]);
    const v = await verdictOf();

    // The three reconstructions a "reasonable default" would reach for. Each is
    // asserted against explicitly, because each would look entirely plausible on
    // screen and none of them is what Meta measured.
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    expect(v.windowEnd).not.toEqual(SYNCED_AT);                                  // ← `date`
    expect(v.windowStart).not.toEqual(new Date(SYNCED_AT.getTime() - THIRTY_DAYS)); // ← date − 30d
    expect(v.windowEnd.getTime() - v.windowStart.getTime()).not.toBe(THIRTY_DAYS);  // ← a synthesised span

    // And the real span is what a 30-day inclusive Meta window actually is.
    expect(v.windowEnd.getTime() - v.windowStart.getTime()).toBe(29 * 24 * 60 * 60 * 1000);
  });

  it('repeats what the row says rather than what the selector asked for', async () => {
    // A row labelled anything other than CUMULATIVE_30D CANNOT come back from
    // selectCanonicalVerdictSnapshots — its `where` admits one value, and the
    // population tests below pin that. Feeding one here is not a claim that it
    // can happen; it is the only way to prove the projection has no opinion.
    //
    // The distinction is the whole design. If this path ever were handed a row
    // of another period, the honest failure is a payload that SAYS so — which a
    // reader can catch. A hardcoded 'CUMULATIVE_30D' would relabel it silently,
    // and produce exactly the un-contradictable caption this slice exists to end.
    mockCampaigns([campaignRow({ measurementWindow: 'ROLLING_WINDOW' })]);
    expect((await verdictOf()).measurementWindow).toBe('ROLLING_WINDOW');
  });
});

describe('3 — the population is enforced upstream, not in the projection', () => {
  it('the verdict path reads canonical evidence and never the operational reader', async () => {
    mockCampaigns([campaignRow()]);
    await getConnectorVerdicts(WS);

    expect(getCanonicalVerdictCampaigns).toHaveBeenCalledWith(WS);
    // The regression this slice must not cause. getConnectorCampaigns returns
    // rows whose period is whatever the last sync requested — `maximum` (~37
    // months) from the Sync button. Sourcing verdicts from it would leave every
    // assertion above passing (the rows would honestly say ROLLING_WINDOW) while
    // the verdicts themselves silently changed measurement.
    expect(getConnectorCampaigns).not.toHaveBeenCalled();
  });

  it('the canonical selector projects the provenance columns it must publish', () => {
    // The gap B1 actually closed. Every layer below already carried these three
    // — metricsOf projects them, toCampaignRow spreads them — and they arrived
    // null on every canonical row because the SELECT never asked for them. The
    // symptom was at the API; the defect was in the query.
    expect(CANONICAL_VERDICT_SELECT.measurementWindow).toBe(true);
    expect(CANONICAL_VERDICT_SELECT.windowStart).toBe(true);
    expect(CANONICAL_VERDICT_SELECT.windowEnd).toBe(true);
  });

  it('the declared basis and the row agree on a canonical read', () => {
    // Not a substitute for either — a cross-check. The basis is what the reader
    // DECLARED it was doing; the row is what came back. They must agree here,
    // and the payload publishes the second one.
    expect(CANONICAL_VERDICT_EVIDENCE_BASIS.measurementWindow).toBe('CUMULATIVE_30D');
    expect(canonicalSnapshot().measurementWindow).toBe(CANONICAL_VERDICT_EVIDENCE_BASIS.measurementWindow);
  });
});

describe('4 — absent provenance stays absent', () => {
  it('a platform that reported no bounds yields null, never a guessed period', async () => {
    mockCampaigns([campaignRow({ windowStart: null, windowEnd: null })]);
    const v = await verdictOf();

    expect(v.windowStart).toBeNull();
    expect(v.windowEnd).toBeNull();
    // The window LABEL survives — the column is NOT NULL on the model, so the
    // row still states its period even when it cannot state its bounds. Partial
    // provenance is still provenance; the surface renders the period and omits
    // the dates.
    expect(v.measurementWindow).toBe('CUMULATIVE_30D');
  });

  it('a row with no window at all publishes three nulls, not a default', async () => {
    mockCampaigns([campaignRow({ measurementWindow: null, windowStart: null, windowEnd: null })]);
    const v = await verdictOf();

    expect(v.measurementWindow).toBeNull();
    expect(v.windowStart).toBeNull();
    expect(v.windowEnd).toBeNull();
  });
});

describe('5 — the existing verdict contract is untouched', () => {
  it('still publishes the fields the surface already depends on', async () => {
    mockCampaigns([campaignRow()]);
    const v = await verdictOf();

    // The verdict itself and its two confidence halves.
    expect(typeof v.verdict).toBe('string');
    expect(v.verdict.length).toBeGreaterThan(0);
    expect(typeof v.confidence).toBe('number');
    expect(typeof v.signalConfidence).toBe('number');
    expect(typeof v.dataConfidence).toBe('number');
    // The metrics the period now describes.
    expect(v.spendMinor).toBe(100_000);
    expect(v.roas).toBe(4);
    // Reasoning + identity.
    expect(typeof v.rationale).toBe('string');
    expect(v).toHaveProperty('rootCause');
    expect(v).toHaveProperty('decisionId');
    expect(v).toHaveProperty('decisionVerdict');
    expect(v).toHaveProperty('decisionEvidenceReference');
    // R13 human judgment — four scalars, all null with no stored decision.
    for (const k of ['humanResponse', 'humanReasonCode', 'humanReasonNote', 'humanRespondedAt']) {
      expect(v).toHaveProperty(k);
      expect(v[k]).toBeNull();
    }
  });

  it('provenance does not change a single verdict', async () => {
    // The claim buildConnectorVerdictTree's comment makes — carried, not
    // computed. Two runs over identical metrics, one with full provenance and
    // one with none, must reach the same conclusion with the same confidence.
    mockCampaigns([campaignRow()]);
    const withWindow = await verdictOf();

    vi.clearAllMocks();
    findMany.mockResolvedValue([]);
    groupBy.mockResolvedValue([]);
    mockCampaigns([campaignRow({ measurementWindow: null, windowStart: null, windowEnd: null })]);
    const without = await verdictOf();

    expect(without.verdict).toBe(withWindow.verdict);
    expect(without.confidence).toBe(withWindow.confidence);
    expect(without.rationale).toBe(withWindow.rationale);
    expect(without.rootCause).toBe(withWindow.rootCause);
  });
});

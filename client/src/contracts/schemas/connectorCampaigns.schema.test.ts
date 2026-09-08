// ============================================================
// PARITY-04 · the SUBJECT axis's two reads get a contract
// ------------------------------------------------------------
// THE DEFECT THIS CLOSES
//
//   setVerdicts(Array.isArray(res.data?.verdicts) ? res.data.verdicts : []);
//
// A 200 whose shape changed became an empty array, with `error` null and
// `loading` false. Every campaign then lands in UNSCORED and the page reads
// "Needs Data" for the whole account — a claim about the operator's account,
// produced by a request that succeeded and was not understood.
//
//     HTTP success  ≠  semantic success
//
// So the four outcomes are kept apart, and the third is the new one:
//
//     request failed                          → error
//     succeeded + valid + empty collection    → measured empty
//     succeeded + INVALID                     → parse error   ← was []
//     succeeded + valid + populated           → data
//
// ── WHAT IS REQUIRED, AND WHY THAT SET ──────────────────────────────────────
// A field a CLAIM reads (FE-03: name every substrate a claim reads, and no
// others). The envelope's collections are required because their absence is the
// whole defect; a row's identity spine is required because a row that cannot be
// identified cannot be rendered; everything else the serializer emits is
// declared but nullish, so the contract documents the wire without turning
// legitimate absence into an outage.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  ConnectorCampaignsResponseSchema,
  ConnectorVerdictsResponseSchema,
  ConnectorCampaignRowSchema,
  ConnectorVerdictRowSchema,
} from './connectorCampaigns.schema';

// Mirrors toCampaignRow + metricsOf + the route's `needsRevenue`.
const row = (over = {}) => ({
  entityId: 'c1',
  evidenceBasis: null,
  channel: 'META',
  name: 'Eid Sales',
  objective: 'OUTCOME_SALES',
  externalId: '238471',
  platformCreatedTime: '2026-07-01T00:00:00.000Z',
  adSetCount: 3,
  evidenceRows: [],
  spendMinor: 100_000,
  roas: 2.4,
  ctr: 0.012,
  frequency: 1.8,
  reach: 40_000,
  conversions: 20,
  revenueMinor: 240_000,
  impressions: 900_000,
  clicks: 10_800,
  actionMetrics: null,
  dailyBudgetMinor: 5_000,
  currency: 'EGP',
  lastDate: '2026-09-07T00:00:00.000Z',
  measurementWindow: 'CUMULATIVE_30D',
  windowStart: '2026-08-09T00:00:00.000Z',
  windowEnd: '2026-09-07T00:00:00.000Z',
  revenueStale: false,
  needsRevenue: false,
  ...over,
});

const campaignsBody = (over = {}) => ({
  workspaceId: 'ws-1',
  generatedAt: '2026-09-08T00:00:00.000Z',
  campaigns: [row()],
  ...over,
});

// Mirrors connectorVerdictService's annotated row + the route's envelope.
const verdict = (over = {}) => ({
  id: 'c1',
  name: 'Eid Sales',
  verdict: 'KILL',
  confidence: 0.82,
  signalConfidence: 0.9,
  dataConfidence: 0.7,
  dataConfidenceDimensions: null,
  rationale: 'Spending below break-even for 14 days.',
  rootCause: null,
  funnel: null,
  counterfactuals: null,
  hypotheses: null,
  relativeRank: null,
  relativeContext: null,
  spendMinor: 100_000,
  decisionId: 'd-1',
  decisionVerdict: 'KILL',
  execution: null,
  humanResponse: null,
  humanRespondedAt: null,
  humanReasonCode: null,
  humanReasonNote: null,
  ...over,
});

const verdictsBody = (over = {}) => ({
  workspaceId: 'ws-1',
  generatedAt: '2026-09-08T00:00:00.000Z',
  verdicts: [verdict()],
  gatedOut: [{ id: 'c2', name: 'Dataless', reason: 'NO_MEASURABLE_DELIVERY' }],
  account: null,
  memoryByEntityId: {},
  decisionHistoryStatus: 'OK',
  decisionHistoryKnowledge: null,
  status: 'OK',
  ...over,
});

describe('PARITY-04 · GET /entities/campaigns', () => {
  it('parses a populated payload and carries every field a claim reads', () => {
    const p = ConnectorCampaignsResponseSchema.safeParse(campaignsBody());
    expect(p.success).toBe(true);
    if (!p.success) return;
    const c = p.data.campaigns[0];
    // C-04's law: a field on the wire is not a field the client has. These all
    // reach a pixel, so the parse must carry them through.
    expect(c.entityId).toBe('c1');
    expect(c.spendMinor).toBe(100_000);
    expect(c.roas).toBe(2.4);
    expect(c.ctr).toBe(0.012);
    expect(c.frequency).toBe(1.8);
    expect(c.currency).toBe('EGP');
    expect(c.adSetCount).toBe(3);
    expect(c.objective).toBe('OUTCOME_SALES');
  });

  it('a MEASURED EMPTY account parses, and stays empty', () => {
    const p = ConnectorCampaignsResponseSchema.safeParse(campaignsBody({ campaigns: [] }));
    expect(p.success).toBe(true);
    if (!p.success) return;
    expect(p.data.campaigns).toEqual([]);
  });

  it('an unsynced row — every metric null — is valid, not an error', () => {
    // Null-when-absent is the serializer's deliberate contract. A schema that
    // rejected it would turn honest absence into an outage.
    const bare = row({
      spendMinor: null, roas: null, ctr: null, frequency: null, reach: null,
      conversions: null, revenueMinor: null, impressions: null, clicks: null,
      dailyBudgetMinor: null, currency: null, lastDate: null,
      measurementWindow: null, windowStart: null, windowEnd: null,
      objective: null, externalId: null, platformCreatedTime: null,
    });
    expect(ConnectorCampaignsResponseSchema.safeParse(campaignsBody({ campaigns: [bare] })).success).toBe(true);
  });

  it('tolerates a field the server ADDS — additive change may not blank a surface', () => {
    const widened = campaignsBody({ campaigns: [row({ somethingNew: { x: 1 } })] });
    expect(ConnectorCampaignsResponseSchema.safeParse(widened).success).toBe(true);
  });

  // ── the failures that used to be [] ────────────────────────────────────────
  it('a MISSING campaigns collection is a parse error, never an empty account', () => {
    const { campaigns, ...noCollection } = campaignsBody();
    expect(campaigns).toBeDefined();
    expect(ConnectorCampaignsResponseSchema.safeParse(noCollection).success).toBe(false);
  });

  it('a RENAMED campaigns collection is a parse error', () => {
    const renamed = { ...campaignsBody(), campaigns: undefined, rows: [row()] };
    expect(ConnectorCampaignsResponseSchema.safeParse(renamed).success).toBe(false);
  });

  it('a WRONG-TYPE collection is a parse error', () => {
    expect(ConnectorCampaignsResponseSchema.safeParse(campaignsBody({ campaigns: {} })).success).toBe(false);
    expect(ConnectorCampaignsResponseSchema.safeParse(campaignsBody({ campaigns: null })).success).toBe(false);
  });

  it('a row missing its IDENTITY is a parse error', () => {
    const { entityId, ...noId } = row();
    expect(entityId).toBeDefined();
    expect(ConnectorCampaignsResponseSchema.safeParse(campaignsBody({ campaigns: [noId] })).success).toBe(false);
    expect(ConnectorCampaignRowSchema.safeParse(row({ entityId: '' })).success).toBe(false);
  });

  it('a WRONG-TYPE metric is a parse error, not a rendered string', () => {
    expect(ConnectorCampaignRowSchema.safeParse(row({ spendMinor: '100000' })).success).toBe(false);
    expect(ConnectorCampaignRowSchema.safeParse(row({ adSetCount: 'three' })).success).toBe(false);
  });
});

describe('PARITY-04 · GET /entities/verdicts', () => {
  it('parses a populated payload and carries the fields the projection allowlists', () => {
    const p = ConnectorVerdictsResponseSchema.safeParse(verdictsBody());
    expect(p.success).toBe(true);
    if (!p.success) return;
    const v = p.data.verdicts[0];
    expect(v.id).toBe('c1');
    expect(v.verdict).toBe('KILL');
    expect(v.confidence).toBe(0.82);
    expect(v.spendMinor).toBe(100_000);
    expect(v.decisionId).toBe('d-1');
    expect(p.data.gatedOut[0].reason).toBe('NO_MEASURABLE_DELIVERY');
  });

  it('the service\'s early return — no annotated tree — is valid', () => {
    // `{ verdicts: [], gatedOut, account: null, status }` with NO memory or
    // decision-history keys. A schema that required them would reject a shape
    // the server legitimately produces.
    const early = {
      workspaceId: 'ws-1',
      generatedAt: '2026-09-08T00:00:00.000Z',
      verdicts: [],
      gatedOut: [],
      account: null,
      status: 'NO_CANONICAL_EVIDENCE',
    };
    expect(ConnectorVerdictsResponseSchema.safeParse(early).success).toBe(true);
  });

  it('every verdict in the engine\'s taxonomy is admitted', () => {
    for (const v of ['KILL', 'HOLD', 'SCALE', 'WATCH', 'REALLOCATE', 'REFRESH']) {
      expect(ConnectorVerdictRowSchema.safeParse(verdict({ verdict: v })).success).toBe(true);
    }
  });

  it('an UNKNOWN verdict is a parse error', () => {
    // Safe to be strict HERE, and only here: render.yaml builds the client from
    // the same commit as the server, so a new verdict cannot reach a browser
    // ahead of the client that admits it. Drift becomes a CI failure instead.
    // The cross-boundary proof lives in src/tests/connectorCampaignsParity.test.js.
    expect(ConnectorVerdictRowSchema.safeParse(verdict({ verdict: 'PAUSE' })).success).toBe(false);
  });

  // ── the failures that used to be [] ────────────────────────────────────────
  it('a MISSING verdicts collection is a parse error, never "nothing scored"', () => {
    const { verdicts, ...noVerdicts } = verdictsBody();
    expect(verdicts).toBeDefined();
    expect(ConnectorVerdictsResponseSchema.safeParse(noVerdicts).success).toBe(false);
  });

  it('gatedOut may NOT silently collapse — a missing collection is a parse error', () => {
    // Its own case. gatedOut carries the C-07 per-reason instruction; losing it
    // takes away WHY a campaign cannot be scored while the campaign still shows
    // as unscored — the operator is told there is a problem and not what it is.
    const { gatedOut, ...noGated } = verdictsBody();
    expect(gatedOut).toBeDefined();
    expect(ConnectorVerdictsResponseSchema.safeParse(noGated).success).toBe(false);
    expect(ConnectorVerdictsResponseSchema.safeParse(verdictsBody({ gatedOut: null })).success).toBe(false);
    expect(ConnectorVerdictsResponseSchema.safeParse(verdictsBody({ gatedOut: {} })).success).toBe(false);
  });

  it('…but a genuinely EMPTY gatedOut is valid — nothing was gated', () => {
    const p = ConnectorVerdictsResponseSchema.safeParse(verdictsBody({ gatedOut: [] }));
    expect(p.success).toBe(true);
    if (!p.success) return;
    expect(p.data.gatedOut).toEqual([]);
  });

  it('a verdict row missing its identity is a parse error', () => {
    const { id, ...noId } = verdict();
    expect(id).toBeDefined();
    expect(ConnectorVerdictRowSchema.safeParse(noId).success).toBe(false);
  });

  it('a WRONG-TYPE confidence is a parse error', () => {
    expect(ConnectorVerdictRowSchema.safeParse(verdict({ confidence: 'high' })).success).toBe(false);
    expect(ConnectorVerdictRowSchema.safeParse(verdict({ spendMinor: '100' })).success).toBe(false);
  });

  it('a gatedOut row keeps its reason as an OPEN vocabulary', () => {
    // Deliberately NOT an enum. gatingReasonCopy already renders an unrecognised
    // reason as no instruction rather than a guessed one (C-07), which is a
    // better failure than killing the page — and unlike `verdict`, nothing here
    // branches exhaustively on it.
    const odd = verdictsBody({ gatedOut: [{ id: 'x', name: 'X', reason: 'SOME_NEW_REASON' }] });
    expect(ConnectorVerdictsResponseSchema.safeParse(odd).success).toBe(true);
  });
});

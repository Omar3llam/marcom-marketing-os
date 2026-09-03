// ============================================================
// Decision Engine v2 — reasoning confidence reaches the verdict
// ------------------------------------------------------------
// What is pinned here:
//   1. the derived reasoning confidence replaces the rule's frozen literal on
//      the MECHANISM track ONLY. Every other branch's number is its own measure
//      of its own evidence — the funnel's especially, which is about a
//      stage-to-stage drop-off the diagnosis rules never saw.
//   2. the early gates still read `extra.hypotheses`, never the closure. Those
//      consts are declared BELOW the gate returns; a closure reference throws
//      only at runtime, only on thin or young campaigns.
//   3. `signalConfidence` survives both allowlists. It was computed on every
//      verdict since the engine existed and published nowhere.
//   4. the published triple multiplies out — for absolute verdicts. It does NOT
//      for relative upgrades, and the scope of that test is the finding.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCanonicalVerdictCampaigns, findMany, groupBy } = vi.hoisted(() => ({
  getCanonicalVerdictCampaigns: vi.fn(), findMany: vi.fn(), groupBy: vi.fn(),
}));
vi.mock('../entity-graph/index.js', () => ({ getCanonicalVerdictCampaigns }));
// Phase D.4: the verdict path reads CANONICAL evidence and is handed an
// envelope — the campaigns that have a canonical row, plus the identities that
// have none. These tests are about the campaigns, so noCanonicalWindow is empty;
// the absence path has its own tests in canonicalVerdictEvidence.test.js.
const mockCampaigns = (rows) => getCanonicalVerdictCampaigns.mockResolvedValue({ campaigns: rows, noCanonicalWindow: [] });
// The verdict feed reads the Decision table twice now — once for identity
// (getLatestDecisions) and once for history (getDecisionHistory). Default: no
// stored decisions, the state every existing assertion below was written in.
// `groupBy` must be present or the history read throws into its own catch and
// the memory projection would be silently untested.
vi.mock('../../lib/prisma.js', () => ({ prisma: { decision: { findMany, groupBy } } }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { evaluateVerdict, rollupVerdicts } from './verdictEngine.js';
import { applyRelativeRanking } from './relativeRanking.js';
import { getConnectorVerdicts } from './connectorVerdictService.js';
import { isSubstantive } from './counterfactualEngine.js';
import { diagnoseFunnel } from './funnelDiagnosis.js';
import { composeConfidence } from './confidenceEngine.js';
import { connectorDecisionScope } from './decisionIdentity.js';
import { SIGNAL_TYPE } from '../diagnosis-engine/diagnosisTypes.js';
import { VERDICT } from './verdictTypes.js';

// Fatigued + weak CTR, with revenue measured: lands on the mechanism track.
const fatigued = {
  roas: 2.0, frequency: 4.0, ctr: 0.7, revenueMeasured: true,
  impressions: 50_000, clicks: 350,
};

// ── The wiring ──────────────────────────────────────────────────────────────
describe('evaluateVerdict — reasoning confidence is the signal half on the mechanism track', () => {
  it('replaces the rule\'s frozen literal with the derived number', () => {
    const v = evaluateVerdict({ level: 'CAMPAIGN', metrics: fatigued });
    expect(v.verdict).toBe(VERDICT.REFRESH);
    expect(v.signalType).toBe(SIGNAL_TYPE.CREATIVE_FATIGUE);
    // The rule literal is 0.85; the evidence converges to 0.95.
    expect(v.signalConfidence).toBe(0.95);
    expect(v.signalConfidence).toBe(v.hypotheses[0].confidence.reasoning);
  });

  it('composes it against data quality, as before', () => {
    const v = evaluateVerdict({ level: 'CAMPAIGN', metrics: fatigued });
    expect(v.confidence).toBe(composeConfidence(v.signalConfidence, v.dataConfidence));
  });

  it('reads the hypothesis, not the diagnosis literal — proven by the legacy shape', () => {
    // A singular pre-picked diagnosis carries no observations, so the projector
    // floors its reasoning at 0.3 even though the rule literal says 0.85.
    const v = evaluateVerdict({
      level: 'CAMPAIGN',
      metrics: fatigued,
      diagnosis: { signalType: SIGNAL_TYPE.CREATIVE_FATIGUE, diagnosis: 'creative_fatigue', confidence: 0.85 },
    });
    expect(v.signalConfidence).toBe(0.3);
  });
});

// ── The branches that keep their own number ─────────────────────────────────
describe('evaluateVerdict — non-mechanism branches are NOT overwritten', () => {
  it('the awareness tier keeps 0.7 even with a 0.95 hypothesis on the node', () => {
    const v = evaluateVerdict({
      level: 'CAMPAIGN',
      metrics: { ...fatigued, roas: null, revenueMeasured: false },
    });
    expect(v.verdict).toBe(VERDICT.REFRESH);
    expect(v.signalConfidence).toBe(0.7);
    // The hypotheses are still computed and attached — they just did not decide.
    expect(v.hypotheses[0].confidence.reasoning).toBe(0.95);
  });

  it('the critical-decline KILL keeps 0.9', () => {
    const v = evaluateVerdict({
      level: 'CAMPAIGN',
      metrics: { ...fatigued, roas: 0.5 },
    });
    expect(v.verdict).toBe(VERDICT.KILL);
    expect(v.signalConfidence).toBe(0.9);
  });

  it('the funnel track keeps the funnel\'s own confidence', () => {
    // A measured post-click collapse: 50 landing-page views off 350 clicks.
    const actionMetrics = { lpv: 50, atc: 5, checkout: 1 };
    const metrics = { ...fatigued, frequency: 2.0 };
    const funnel = diagnoseFunnel({
      ctr: metrics.ctr, actionMetrics, clicks: metrics.clicks, objective: 'OUTCOME_SALES',
    });
    expect(funnel).not.toBeNull();

    const v = evaluateVerdict({
      level: 'CAMPAIGN', metrics, actionMetrics, objective: 'OUTCOME_SALES',
    });
    expect(v.verdict).toBe(VERDICT.WATCH);
    // A number derived from CTR and frequency must never end up attached to a
    // verdict decided by a broken checkout.
    expect(v.signalConfidence).toBe(funnel.confidence);
  });

  it('the healthy branch keeps its SCALE / HOLD tiers', () => {
    const v = evaluateVerdict({
      level: 'CAMPAIGN',
      metrics: { roas: 4.0, frequency: 1.2, ctr: 3.0, revenueMeasured: true, impressions: 50_000, clicks: 1_500 },
    });
    expect(v.verdict).toBe(VERDICT.SCALE);
    expect(v.signalConfidence).toBe(0.8);
    expect(v.hypotheses).toEqual([]); // HEALTHY projects nothing
  });
});

// ── The gates ───────────────────────────────────────────────────────────────
describe('evaluateVerdict — the early gates are untouched', () => {
  it('the minimum-sample gate still states 1.0', () => {
    const v = evaluateVerdict({ level: 'CAMPAIGN', metrics: { ...fatigued, impressions: 100 } });
    expect(v.signalConfidence).toBe(1.0);
    expect(v.hypotheses).toEqual([]);
  });

  it('the too-early gate still states 1.0', () => {
    const v = evaluateVerdict({ level: 'CAMPAIGN', metrics: fatigued, daysRunning: 1 });
    expect(v.signalConfidence).toBe(1.0);
  });

  // Both gates return ABOVE the `const hypotheses` declaration. If finalise ever
  // reads those bindings from the enclosing scope instead of from `extra`, these
  // throw ReferenceError rather than failing an assertion.
  it('returns from both gates without touching the un-initialised bindings', () => {
    expect(() => evaluateVerdict({ level: 'CAMPAIGN', metrics: { ...fatigued, impressions: 1 } })).not.toThrow();
    expect(() => evaluateVerdict({ level: 'CAMPAIGN', metrics: fatigued, daysRunning: 0 })).not.toThrow();
  });
});

// ── source ──────────────────────────────────────────────────────────────────
describe('hypothesis.source — which pass produced this reasoning', () => {
  it('tags every hypothesis on the absolute path', () => {
    const v = evaluateVerdict({ level: 'CAMPAIGN', metrics: fatigued });
    expect(v.hypotheses.length).toBeGreaterThan(0);
    expect(v.hypotheses.every((h) => h.source === 'absolute')).toBe(true);
  });

  it('has nothing to tag when the diagnosis is terminal', () => {
    const v = evaluateVerdict({
      level: 'CAMPAIGN',
      metrics: { roas: 4.0, frequency: 1.2, ctr: 3.0, revenueMeasured: true, impressions: 50_000, clicks: 1_500 },
    });
    expect(v.hypotheses).toEqual([]);
  });
});

// ── signalConfidence through both allowlists ────────────────────────────────
describe('signalConfidence — the half that was never published', () => {
  const leaf = (id, over = {}) => ({
    id, level: 'CAMPAIGN', currency: 'USD',
    metrics: {
      spendMinor: 100_000, revenueMinor: 200_000, impressions: 50_000,
      clicks: 350, conversions: 0, frequency: 4.0, ...over,
    },
  });

  it('survives the rollupVerdicts allowlist', () => {
    const [node] = rollupVerdicts({ id: 'a', level: 'ACCOUNT', children: [leaf('c1')] }).children;
    expect(node.signalConfidence).toBeTypeOf('number');
    expect(Number.isFinite(node.signalConfidence)).toBe(true);
  });

  // Three awareness siblings, all HOLD on the absolute pass, so the cohort ranks:
  // highest CTR → SCALE, lowest → KILL, the middle one untouched.
  const rankedTree = () => {
    const sib = (id, clicks) => ({
      id, level: 'CAMPAIGN', currency: 'USD',
      metrics: { spendMinor: 100_000, revenueMinor: 0, impressions: 50_000, clicks, conversions: 0, frequency: 2.0 },
    });
    const before = rollupVerdicts({
      id: 'a', level: 'ACCOUNT', children: [sib('lo', 250), sib('mid', 300), sib('hi', 350)],
    });
    return { before, after: applyRelativeRanking(before) };
  };
  const childOf = (node, id) => node.children.find((c) => c.id === id);

  it('is re-stamped with the ranking\'s own strength on an upgraded row', () => {
    const { before, after } = rankedTree();
    const lo = childOf(after, 'lo');

    expect(lo.verdict).toBe(VERDICT.KILL);
    expect(lo.relativeRank).toBe('BOTTOM');
    // RR.CONFIDENCE — module-local in relativeRanking.js, mirrored here.
    expect(lo.signalConfidence).toBe(0.6);
    expect(lo.signalConfidence).not.toBe(childOf(before, 'lo').signalConfidence);
    // …and the published number still decomposes into its two halves.
    expect(lo.verdictConfidence).toBe(composeConfidence(0.6, lo.dataConfidence));
  });

  it('is left by reference on a row the cohort did not move', () => {
    const { before, after } = rankedTree();
    const mid = childOf(after, 'mid');
    expect(mid.relativeRank).toBeUndefined();
    expect(mid.signalConfidence).toBe(childOf(before, 'mid').signalConfidence);
  });

  // The upgrade changes the VERDICT and the numbers that describe it. The
  // diagnostic artifacts are observations about the entity — they stay true
  // regardless of which pass decided, and must survive byte-for-byte.
  it('leaves the diagnostic artifacts untouched', () => {
    const { before, after } = rankedTree();
    const b = childOf(before, 'lo');
    const a = childOf(after, 'lo');

    expect(a.hypotheses).toEqual(b.hypotheses);
    expect(a.counterfactuals).toEqual(b.counterfactuals);
    expect(a.declined).toEqual(b.declined);
    expect(a.rootCause).toBe(b.rootCause);
    expect(a.signalType).toBe(b.signalType);
  });

  it('keeps every hypothesis tagged as the absolute pass\'s', () => {
    const { after } = rankedTree();
    const lo = childOf(after, 'lo');
    expect(lo.hypotheses.length).toBeGreaterThan(0);
    expect(lo.hypotheses.every((h) => h.source === 'absolute')).toBe(true);
  });
});

// ── The payload ─────────────────────────────────────────────────────────────
describe('getConnectorVerdicts — the published numbers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([]); // no stored decisions unless a test says so
    groupBy.mockResolvedValue([]);
  });

  const row = (over = {}) => ({
    entityId: 'c1', name: 'Campaign', channel: 'META', objective: null,
    spendMinor: 100_000, revenueMinor: 200_000, impressions: 50_000, clicks: 350,
    conversions: 0, frequency: 4.0, currency: 'USD', ...over,
  });

  it('carries signalConfidence — null, never undefined, when absent', async () => {
    mockCampaigns([row()]);
    const { verdicts } = await getConnectorVerdicts('ws-1');
    expect(verdicts[0].signalConfidence).toBeTypeOf('number');
  });

  // GOLDEN: the three numbers must multiply out, so a reader can decompose a
  // confidence instead of guessing which half was weak.
  //
  // NO BRANCH ON relativeRank. It was scoped to absolute rows while an upgrade
  // recomposed `confidence` from its own 0.6 but left `signalConfidence` as the
  // absolute pass's. The upgrade now re-stamps both, so the invariant holds
  // everywhere — and the absence of the filter is the proof.
  //
  // The invariant's precondition is a KNOWN sample size: `finalise` and the
  // upgrade both short-circuit to the bare signal half when dataConfidence is
  // null, and composeConfidence(x, null) is 0, so the two would disagree. The
  // connector path always supplies impressions; the assertion below states that
  // rather than leaving it to be rediscovered.
  it('confidence === signal × data, on every row', async () => {
    mockCampaigns([
      // A revenue campaign — absolute, never a ranking candidate.
      row({ entityId: 'rev' }),
      // Three no-revenue siblings: one cohort, so the extremes get upgraded.
      row({ entityId: 'lo',  revenueMinor: 0, frequency: 2.0, clicks: 250 }),
      row({ entityId: 'mid', revenueMinor: 0, frequency: 2.0, clicks: 300 }),
      row({ entityId: 'hi',  revenueMinor: 0, frequency: 2.0, clicks: 350 }),
    ]);
    const { verdicts } = await getConnectorVerdicts('ws-1');

    // Both populations must be present, or "widened" proves nothing.
    expect(verdicts.filter((v) => v.relativeRank != null).length).toBeGreaterThan(0);
    expect(verdicts.filter((v) => v.relativeRank == null).length).toBeGreaterThan(0);

    for (const v of verdicts) {
      expect(v.dataConfidence).not.toBeNull();
      expect(v.confidence).toBe(composeConfidence(v.signalConfidence, v.dataConfidence));
    }
  });

  // ── Decision identity ──────────────────────────────────────────────────────
  // The verdict beside this is recomputed on every read and persists nothing;
  // the Decision is what Lumi committed to at an earlier moment. Projecting the
  // id lets a click land on ONE ROW instead of on a query the server re-resolves
  // — and projecting the stored verdict lets a client see the call has moved on
  // without a second fetch. Neither is reconciled with the live verdict here.
  const decisionRow = (over = {}) => ({
    id: 'dec-1', entityId: 'c1', verdict: 'HOLD', createdAt: new Date('2026-08-01'), ...over,
  });

  it('projects the id of the stored decision for an entity', async () => {
    mockCampaigns([row()]);
    findMany.mockResolvedValue([decisionRow()]);
    const { verdicts } = await getConnectorVerdicts('ws-1');
    expect(verdicts[0].decisionId).toBe('dec-1');
  });

  // null, never undefined — the client branches on it to pick a route, and an
  // absent key would read as "no id" only by accident.
  it('projects null, not undefined, when no sweep has written one', async () => {
    mockCampaigns([row()]);
    findMany.mockResolvedValue([]);
    const { verdicts } = await getConnectorVerdicts('ws-1');
    expect(verdicts[0]).toHaveProperty('decisionId', null);
    expect(verdicts[0]).toHaveProperty('decisionVerdict', null);
  });

  // NAMED: live verdict and decisionId are independent — no reconciliation.
  // The engine says KILL now; the stored row says HOLD. Both are true of
  // different moments, and the payload must carry both without one editing the
  // other — a service that "corrected" either would publish a third opinion no
  // pass ever computed.
  it('live verdict and decisionId are independent — no reconciliation', async () => {
    mockCampaigns([
      row({ entityId: 'c1', revenueMinor: 10, frequency: 4.0, clicks: 350 }),
    ]);
    findMany.mockResolvedValue([decisionRow({ verdict: 'HOLD' })]);
    const { verdicts } = await getConnectorVerdicts('ws-1');

    expect(verdicts[0].decisionId).toBe('dec-1');
    expect(verdicts[0].decisionVerdict).toBe('HOLD');
    expect(verdicts[0].verdict).not.toBe('HOLD');   // the live call moved on
    expect(verdicts[0].verdict).toBeTruthy();       // and was not suppressed
  });

  // NAMED: an ADSET-level Decision does not pollute the CAMPAIGN projection.
  // persistNode writes one Decision per NODE into one table keyed by entityId.
  // The filter is in the WHERE clause, so the guard is that we ask the database
  // for it — an ad-set row arriving here would win the first-hit-wins race and
  // hand a campaign an id that executes against a different entity.
  it('ADSET-level Decision does not pollute CAMPAIGN projection', async () => {
    mockCampaigns([row()]);
    findMany.mockResolvedValue([decisionRow()]);
    await getConnectorVerdicts('ws-1');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ entityLevel: 'CAMPAIGN', status: 'PROPOSED' }),
    }));
  });

  // NAMED: campaign decision identity excludes guardrail and allocation decisions.
  //
  // Level is NOT enough. Four services besides the verdict engine write
  // CAMPAIGN-level PROPOSED rows, three of them against a real campaign
  // entityId — a guardrail hit, an incrementality readout, an allocation move.
  // Every one is a proposal about the same campaign; none is the verdict on
  // screen. Without the author filter the first-hit-wins race is decided by
  // createdAt across all of them, and the id behind a KILL button becomes
  // whichever service wrote last.
  //
  // The filter is a WHERE clause, so this asserts the QUERY excludes them —
  // asserting on a hand-fed row set would only prove the loop, which is not
  // where the bug was.
  it('campaign decision identity excludes guardrail and allocation decisions', async () => {
    mockCampaigns([row()]);
    await getConnectorVerdicts('ws-1');

    const { where } = findMany.mock.calls[0][0];
    expect(where.OR).toBeDefined();

    // Connector causes are named explicitly; null is IN the set, because the
    // engine leaves it null on verdicts reached without a diagnosis.
    const named = where.OR.find((c) => c.rootCause?.in)?.rootCause.in ?? [];
    expect(where.OR).toContainEqual({ rootCause: null });
    expect(named).toContain(SIGNAL_TYPE.CREATIVE_FATIGUE);

    // And every foreign author's prefix is absent from the allowed set.
    for (const foreign of ['guardrail:', 'allocation:', 'incrementality:', 'test:']) {
      expect(named.some((c) => String(c).startsWith(foreign))).toBe(false);
    }
  });

  // The half that a naive fix would still get wrong. Ordering is `createdAt`
  // desc + first-hit-wins, so a foreign row written AFTER the sweep is exactly
  // the one positioned to win — and the database, not the loop, is what has to
  // refuse it.
  it('a newer allocation decision cannot steal a campaign identity', async () => {
    mockCampaigns([row({ entityId: 'c1' })]);
    // What the scoped query returns: the foreign rows never come back at all.
    findMany.mockImplementation(async ({ where }) => {
      const all = [
        { id: 'alloc-2',  entityId: 'c1', verdict: 'REALLOCATE', rootCause: 'allocation:plan-1', createdAt: new Date('2026-08-05') },
        { id: 'guard-1',  entityId: 'c1', verdict: 'KILL',       rootCause: 'guardrail:frequency', createdAt: new Date('2026-08-04') },
        { id: 'conn-1',   entityId: 'c1', verdict: 'KILL',       rootCause: SIGNAL_TYPE.CREATIVE_FATIGUE, createdAt: new Date('2026-08-01') },
      ];
      const allowed = where.OR.find((c) => c.rootCause?.in)?.rootCause.in ?? [];
      return all.filter((d) => d.rootCause === null || allowed.includes(d.rootCause));
    });

    const { verdicts } = await getConnectorVerdicts('ws-1');
    // The OLDEST row wins, because it is the only one that is ours.
    expect(verdicts[0].decisionId).toBe('conn-1');
    expect(verdicts[0].decisionVerdict).toBe('KILL');
    expect(verdicts[0].decisionId).not.toBe('alloc-2');
  });

  // The same scope the write twin supersedes on. Two answers to "which rows are
  // ours" is how a row becomes un-supersedable in one place and invisible in
  // the other.
  it('scopes identity with the same definition the write path supersedes with', async () => {
    mockCampaigns([row()]);
    await getConnectorVerdicts('ws-1');
    expect(findMany.mock.calls[0][0].where.OR).toEqual(connectorDecisionScope().OR);
  });

  it('scopes the read to the workspace, and selects rather than taking the row whole', async () => {
    mockCampaigns([row()]);
    await getConnectorVerdicts('ws-1');
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.workspaceId).toBe('ws-1');
    // R5 adds `evidenceReference` — the one thing about a STORED decision this
    // payload can never re-derive, since the verdict beside it is recomputed
    // from today's rows. R13-b adds the four judgement columns, without which
    // the surface cannot know on first render that this decision was already
    // judged. Still a named projection, so the two reasoning JSONB columns are
    // not pulled per row to be discarded — and still an exact equality, so a
    // select-less read or an unplanned column fails here.
    expect(arg.select).toEqual({
      id: true, entityId: true, verdict: true, createdAt: true, evidenceReference: true,
      humanResponse: true, humanReasonCode: true, humanReasonNote: true, humanRespondedAt: true,
    });
    expect(arg).not.toHaveProperty('include');
  });

  // Most recent wins. `orderBy` desc plus first-hit-wins is the whole mechanism,
  // so a test that only seeds one row would pass with no ordering at all.
  it('takes the most recent when an entity has several', async () => {
    mockCampaigns([row()]);
    findMany.mockResolvedValue([
      decisionRow({ id: 'newest', createdAt: new Date('2026-08-05') }),
      decisionRow({ id: 'older',  createdAt: new Date('2026-07-01') }),
    ]);
    const { verdicts } = await getConnectorVerdicts('ws-1');
    expect(verdicts[0].decisionId).toBe('newest');
    expect(findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });
  });

  it('leaves a campaign with no decision of its own untouched', async () => {
    mockCampaigns([row({ entityId: 'c1' }), row({ entityId: 'c2' })]);
    findMany.mockResolvedValue([decisionRow({ entityId: 'c1' })]);
    const { verdicts } = await getConnectorVerdicts('ws-1');
    expect(verdicts.find((v) => v.id === 'c1').decisionId).toBe('dec-1');
    expect(verdicts.find((v) => v.id === 'c2').decisionId).toBeNull();
  });

  // PARALLEL, not sequential. The decision read is keyed by workspace and needs
  // nothing from the campaigns, so it must not wait behind them. Proof: with no
  // campaigns at all the function returns early — and the query has still been
  // issued, which can only happen if both were started together.
  it('issues both reads together rather than one behind the other', async () => {
    mockCampaigns([]);
    const { verdicts, status } = await getConnectorVerdicts('ws-1');
    expect(status).toBe('NO_CAMPAIGNS');
    expect(verdicts).toEqual([]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  // The N+1 guard. Two reads TOTAL — identity and history — however many
  // campaigns the feed carries, so the count must not move with the row count.
  it.each([[1], [3], [12]])('asks the database twice for a feed of %i campaigns', async (n) => {
    mockCampaigns(
      Array.from({ length: n }, (_, i) => row({ entityId: `c${i}` })),
    );
    await getConnectorVerdicts('ws-1');
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(groupBy).toHaveBeenCalledTimes(1);
  });

  // Identity is an ENHANCEMENT. Losing it costs the precise route; losing the
  // verdict feed costs the whole screen.
  it('still publishes verdicts when the decision read fails', async () => {
    mockCampaigns([row()]);
    findMany.mockRejectedValue(new Error('column does not exist'));
    const { verdicts } = await getConnectorVerdicts('ws-1');
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].decisionId).toBeNull();
  });

  // ── Memory rides BESIDE the verdicts, never inside them ────────────────────
  // A verdict is what Lumi thinks now, computed from live signals. History is
  // what it said before. Folding the second into the first would put an older
  // opinion inside the object the engine owns.
  it('publishes history as a separate map, keyed by entity', async () => {
    mockCampaigns([row({ entityId: 'c1' })]);
    groupBy.mockResolvedValue([{ entityId: 'c1', _count: { _all: 3 } }]);
    findMany.mockImplementation(async ({ select }) => (
      // The history read selects `status`; the identity read does not.
      select?.status
        ? [{ id: 'h1', entityId: 'c1', verdict: 'KILL', status: 'SUPERSEDED', createdAt: new Date('2026-08-01'), executedAt: null, dismissedAt: null, resolution: 'IMPROVED', confidenceDelta: 0.2 }]
        : []
    ));

    const res = await getConnectorVerdicts('ws-1');
    expect(res.memoryByEntityId.c1.count).toBe(3);
    expect(res.memoryByEntityId.c1.items[0].verdict).toBe('KILL');
    // And the verdict object itself is untouched by any of it. `memory` here
    // means PAST DECISIONS about this campaign — R10's `institutionalMemory`
    // field is a different thing entirely (the account's validated patterns),
    // which is exactly why it is not named `memory`.
    expect(res.verdicts[0]).not.toHaveProperty('memory');
    expect(res.verdicts[0]).not.toHaveProperty('history');
  });

  it('publishes an empty map rather than omitting it when there is no history', async () => {
    mockCampaigns([row()]);
    const res = await getConnectorVerdicts('ws-1');
    expect(res.memoryByEntityId).toEqual({});
  });

  // ── C-03 · why the empty map is not the whole answer ──────────────────────
  // The test directly above passes in TWO different worlds: one where we read
  // the decision table and this account has judged nothing, and one where the
  // read failed. Until this block, the payload said the same thing in both.
  //
  // `decisionHistoryStatus` and not `memoryStatus`: two different things in this
  // response already wear the word "memory" — `memoryByEntityId` (this
  // campaign's past DECISIONS) and `institutionalMemory` (the account's
  // validated PATTERNS) — and the service comment above names that collision as
  // the reason the second one is spelled out in full. A bare `memoryStatus`
  // would read as the status of the wrong one.
  describe('C-03 · the payload says whether it could look', () => {
    // The history read is the ONLY consumer of groupBy here; the identity read
    // (getLatestDecisions) uses findMany alone. Rejecting groupBy therefore
    // fails history and nothing else, which is the isolation this needs.
    const breakHistory = () => groupBy.mockRejectedValue(new Error('read failed'));

    it('OK when the read happened and found nothing', async () => {
      mockCampaigns([row()]);
      const res = await getConnectorVerdicts('ws-1');
      expect(res.decisionHistoryStatus).toBe('OK');
      // C-06 — 'we looked' is KNOWN, even though what we found was nothing.
      // The token classifies whether the claim can be made, not what it says.
      expect(res.decisionHistoryKnowledge).toBe('KNOWN');
      expect(res.memoryByEntityId).toEqual({});
    });

    it('HISTORY_UNAVAILABLE when the read failed — and the feed still answers', async () => {
      mockCampaigns([row()]);
      breakHistory();
      const res = await getConnectorVerdicts('ws-1');

      expect(res.decisionHistoryStatus).toBe('HISTORY_UNAVAILABLE');
      // C-06 — and the same fact in the shared language, published beside it.
      // A client can act on COULD_NOT_LOOK without ever learning that THIS
      // vocabulary spells it HISTORY_UNAVAILABLE.
      expect(res.decisionHistoryKnowledge).toBe('COULD_NOT_LOOK');
      expect(res.memoryByEntityId).toEqual({});
      // History is context, not the call. Losing it costs the Memory section.
      expect(res.verdicts).toHaveLength(1);
      // And the FEED's own status is untouched: it describes workspace/verdict
      // readiness, not a memory subsection. Collapsing one into the other would
      // trade this defect for a larger one.
      expect(res.status).toBe('OK');
    });

    // TEST 9 — the invariant the whole slice is measured against. History is not
    // decision authority: it may not move a verdict, a confidence, or an order.
    // Asserted by EQUALITY of the two payloads rather than by a comment, because
    // a comment cannot fail.
    it('a history failure changes decisionHistoryStatus and nothing else', async () => {
      mockCampaigns([row()]);
      const healthy = await getConnectorVerdicts('ws-1');

      // Same fixtures, same engine, ONE variable changed. Not re-mocked in
      // between: a fresh setup would make this a comparison of two arrangements
      // rather than of one system under two read outcomes.
      breakHistory();
      const broken = await getConnectorVerdicts('ws-1');

      expect(broken.verdicts).toEqual(healthy.verdicts);
      expect(broken.account).toEqual(healthy.account);
      expect(broken.gatedOut).toEqual(healthy.gatedOut);
      expect(broken.memoryByEntityId).toEqual(healthy.memoryByEntityId);
      expect(broken.status).toBe(healthy.status);
      expect(broken.decisionHistoryStatus).not.toBe(healthy.decisionHistoryStatus);
    });
  });

  // The cohort figures reach the payload, or the block that renders them has
  // nothing to render. Same three-seam walk `signalConfidence` needed: minted in
  // rankCohort, spread onto the node by applyRelativeRanking, and NAMED here.
  //
  // It skips rollupVerdicts' allowlist entirely — that pass runs first, and the
  // upgrade spreads `...c` over its output — which is why a field that allowlist
  // never mentions still arrives intact.
  it('publishes the cohort a relative verdict was decided in', async () => {
    mockCampaigns([
      row({ entityId: 'lo',  revenueMinor: 0, frequency: 2.0, clicks: 250 }),
      row({ entityId: 'mid', revenueMinor: 0, frequency: 2.0, clicks: 300 }),
      row({ entityId: 'hi',  revenueMinor: 0, frequency: 2.0, clicks: 350 }),
    ]);
    const { verdicts } = await getConnectorVerdicts('ws-1');
    const lo = verdicts.find((v) => v.id === 'lo');

    expect(lo.relativeRank).toBe('BOTTOM');
    expect(lo.relativeContext).toMatchObject({ rank: 'BOTTOM', group: 'awareness', cohortSize: 3 });
    expect(lo.relativeContext.ctrPct).toBeTypeOf('number');
    expect(lo.relativeContext.avgCtrPct).toBeTypeOf('number');
  });

  // null, never undefined: the projection is an explicit allowlist, and an
  // absent key is how a field silently stops existing two hops later.
  it('is null on a verdict no cohort decided', async () => {
    mockCampaigns([row()]);
    const { verdicts } = await getConnectorVerdicts('ws-1');
    expect(verdicts[0].relativeRank).toBeNull();
    expect(verdicts[0].relativeContext).toBeNull();
  });

  it('publishes a real signal half on every row, upgraded or not', async () => {
    mockCampaigns([
      row({ entityId: 'lo',  revenueMinor: 0, frequency: 2.0, clicks: 250 }),
      row({ entityId: 'mid', revenueMinor: 0, frequency: 2.0, clicks: 300 }),
      row({ entityId: 'hi',  revenueMinor: 0, frequency: 2.0, clicks: 350 }),
    ]);
    const { verdicts } = await getConnectorVerdicts('ws-1');
    for (const v of verdicts) {
      expect(v.signalConfidence).toBeTypeOf('number');
      expect(v.signalConfidence).not.toBeNull();
    }
  });

  // A node that never passes through applyRelativeRanking has no `relativeRank`
  // property at all — the projection is what turns that into null. Anything
  // branching on it at the NODE level must use `== null`, not `=== null`.
  it('normalises an absent relativeRank to null in the payload', async () => {
    mockCampaigns([row()]);
    const { verdicts } = await getConnectorVerdicts('ws-1');
    expect(verdicts[0].relativeRank).toBeNull();

    const [node] = rollupVerdicts({
      id: 'a', level: 'ACCOUNT',
      children: [{ id: 'c1', level: 'CAMPAIGN', currency: 'USD', metrics: {
        spendMinor: 100_000, revenueMinor: 200_000, impressions: 50_000,
        clicks: 350, conversions: 0, frequency: 4.0,
      } }],
    }).children;
    expect(node.relativeRank).toBeUndefined();
  });

  it('publishes only counterfactuals that say something', async () => {
    mockCampaigns([row()]);
    const { verdicts } = await getConnectorVerdicts('ws-1');
    expect(verdicts[0].counterfactuals.length).toBeGreaterThan(0);
    expect(verdicts[0].counterfactuals.every(isSubstantive)).toBe(true);
  });
});

// ── The guard itself ────────────────────────────────────────────────────────
describe('isSubstantive — an argument with no reason is not published', () => {
  it('rejects a counterfactual with both halves empty', () => {
    expect(isSubstantive({ rejectedBy: [], preferredBecause: [] })).toBe(false);
    expect(isSubstantive({})).toBe(false);
    expect(isSubstantive(null)).toBe(false);
  });

  it('keeps one with a contradiction', () => {
    expect(isSubstantive({ rejectedBy: [{ metric: 'CTR' }], preferredBecause: [] })).toBe(true);
  });

  it('keeps one with distinguishing evidence', () => {
    expect(isSubstantive({ rejectedBy: [], preferredBecause: [{ metric: 'FREQUENCY' }] })).toBe(true);
  });
});

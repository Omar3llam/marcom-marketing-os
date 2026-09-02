// ============================================================
// persistNode — stamping metrics, and closing out the verdict it replaces
// ------------------------------------------------------------
// The write side of the lifecycle. Two things happen on a verdict CHANGE:
// the new row records the metrics as they stand (the only moment they can be
// captured — a MetricSnapshot is a rolling aggregate that cannot be read
// backwards), and the row it replaces is resolved.
//
// The seam matters: resolution fires on a re-judgement, NOT on the
// supersede-dropped path, where a campaign simply fell out of the eligible set
// and was never looked at again.
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: { decision: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), update: vi.fn() } },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../lib/prisma.js';
import { persistLevelVerdicts } from './VerdictService.js';
import { connectorDecisionScope, CONNECTOR_ROOT_CAUSES } from './decisionIdentity.js';

const WS = 'ws-1';
const ID = 'c1c1c1c1-0000-4000-8000-000000000001';

// rollupVerdicts RE-DERIVES signalInput from raw leaf metrics — it does not
// accept a pre-annotated node — so these fixtures feed real metrics and let the
// engine produce the verdict. 164/10_000 → ctr 1.64%, and no revenue → roas null
// (the awareness track), which the engine scores HOLD.
const DERIVED_VERDICT = 'HOLD';

const tree = (metrics = {}, node = {}) => ({
  id: null, level: null, name: 'acct',
  children: [{
    id: ID, level: 'CAMPAIGN', name: 'Eid', children: [],
    metrics: {
      spendMinor: 100_000, impressions: 10_000, clicks: 164,
      conversions: 0, revenueMinor: 0, frequency: 2.1, ...metrics,
    },
    ...node,
  }],
});

const created = () => prisma.decision.create.mock.calls[0][0].data;
const resolved = () => prisma.decision.update.mock.calls[0][0];

beforeEach(() => {
  vi.clearAllMocks();
  prisma.decision.findFirst.mockResolvedValue(null);
  prisma.decision.create.mockResolvedValue({ id: 'new-1' });
  prisma.decision.update.mockResolvedValue({});
});

describe('stamping the metrics at decision time', () => {
  // toBeCloseTo, not toBe: 164/10_000*100 is 1.6400000000000001 in binary
  // floating point, and the engine's derived value is what gets stored.
  it('records ctr and roas on the new row', async () => {
    await persistLevelVerdicts(WS, tree());
    expect(created().ctrAtDecision).toBeCloseTo(1.64, 6);
    expect(created().roasAtDecision).toBeNull();
  });

  // signalInput.ctr is clicks/impressions*100. Storing the 0..1 ratio instead
  // would make every later comparison compare two different units — the schism
  // that silently turns a percent threshold into a no-op against a ratio.
  it('keeps CTR in verdictEngine PERCENT units, not the snapshot ratio', async () => {
    await persistLevelVerdicts(WS, tree());
    expect(created().ctrAtDecision).toBeGreaterThan(1);
    expect(created().ctrAtDecision).not.toBeCloseTo(0.0164, 4);
  });

  it('an unmeasured roas stays null, never a fabricated 0', async () => {
    await persistLevelVerdicts(WS, tree({ revenueMinor: 0 }));
    expect(created().roasAtDecision).toBeNull();
  });

  it('a measured roas is stamped as the real ratio', async () => {
    await persistLevelVerdicts(WS, tree({ revenueMinor: 300_000, spendMinor: 100_000 }));
    expect(created().roasAtDecision).toBeCloseTo(3.0, 5);
  });

  // A campaign that never delivered has a derived CTR of 0, and a zero baseline
  // makes any later ratio undefined — so it resolves UNKNOWN rather than reading
  // as a total collapse. The guard is in computeResolution; this pins that the
  // value reaching it is the engine's own.
  it('no delivery stamps the engine derived 0, which later resolves UNKNOWN', async () => {
    await persistLevelVerdicts(WS, tree({ impressions: 0, clicks: 0 }));
    expect(created().ctrAtDecision).toBe(0);
  });
});

// verdict + rootCause + entityLevel were already stored; these two complete it.
// Both ride on the node from buildConnectorVerdictTree.
describe('stamping the similarity key', () => {
  it('records objective and channel from the node', async () => {
    await persistLevelVerdicts(WS, tree({}, { objective: 'OUTCOME_SALES', channel: 'META' }));
    expect(created()).toMatchObject({ objective: 'OUTCOME_SALES', channel: 'META' });
  });

  // A non-connector caller supplies neither. Null is the honest record of "we
  // were never told" — and the learning query widens rather than matching null.
  it('a node carrying neither stores null, not a guess', async () => {
    await persistLevelVerdicts(WS, tree());
    expect(created()).toMatchObject({ objective: null, channel: null });
  });

  it('keeps the rest of the key that was already stored', async () => {
    await persistLevelVerdicts(WS, tree({}, { channel: 'META' }));
    expect(created()).toMatchObject({ verdict: DERIVED_VERDICT, entityLevel: 'CAMPAIGN' });
    expect(created()).toHaveProperty('rootCause');
  });
});

describe('resolving the verdict being replaced', () => {
  const previous = (over = {}) => ({
    id: 'old-1', verdict: 'REFRESH', ctrAtDecision: 1.0, roasAtDecision: null, ...over,
  });

  it('supersedes it and records what happened in between', async () => {
    prisma.decision.findFirst.mockResolvedValue(previous());
    await persistLevelVerdicts(WS, tree()); // now ctr 1.64, up from 1.0

    expect(resolved().where).toEqual({ id: 'old-1' });
    expect(resolved().data).toMatchObject({ status: 'SUPERSEDED', resolution: 'IMPROVED' });
    expect(resolved().data.resolvedAt).toBeInstanceOf(Date);
    expect(resolved().data.confidenceDelta).toBeCloseTo(0.64, 5);
  });

  it('scores a decline as WORSENED', async () => {
    prisma.decision.findFirst.mockResolvedValue(previous({ ctrAtDecision: 4.0 }));
    await persistLevelVerdicts(WS, tree());
    expect(resolved().data.resolution).toBe('WORSENED');
  });

  // Every row written before the lifecycle columns existed.
  it('a previous row with no baseline resolves UNKNOWN, not a guess', async () => {
    prisma.decision.findFirst.mockResolvedValue(previous({ ctrAtDecision: null }));
    await persistLevelVerdicts(WS, tree());
    expect(resolved().data).toMatchObject({ status: 'SUPERSEDED', resolution: 'UNKNOWN', confidenceDelta: null });
  });

  it('the FIRST verdict for an entity resolves nothing', async () => {
    prisma.decision.findFirst.mockResolvedValue(null);
    await persistLevelVerdicts(WS, tree());
    expect(prisma.decision.create).toHaveBeenCalled();
    expect(prisma.decision.update).not.toHaveBeenCalled();
  });

  // persistNode only writes on a CHANGE, so an unchanged verdict must leave the
  // live row alone — resolving it would retire a verdict still in force.
  it('an unchanged verdict writes nothing at all', async () => {
    prisma.decision.findFirst.mockResolvedValue(previous({ verdict: DERIVED_VERDICT }));
    await persistLevelVerdicts(WS, tree());
    expect(prisma.decision.create).not.toHaveBeenCalled();
    expect(prisma.decision.update).not.toHaveBeenCalled();
  });

  // The new verdict is the load-bearing row; telemetry about the old one is not
  // worth losing it over.
  it('a failed resolution never costs the sweep its new verdict', async () => {
    prisma.decision.findFirst.mockResolvedValue(previous());
    prisma.decision.update.mockRejectedValue(new Error('db down'));

    const out = await persistLevelVerdicts(WS, tree());
    expect(out.created).toHaveLength(1);
    expect(prisma.decision.create).toHaveBeenCalled();
  });

  it('resolves AFTER the replacement exists, never before', async () => {
    prisma.decision.findFirst.mockResolvedValue(previous());
    const order = [];
    prisma.decision.create.mockImplementation(async () => { order.push('create'); return { id: 'new-1' }; });
    prisma.decision.update.mockImplementation(async () => { order.push('resolve'); return {}; });

    await persistLevelVerdicts(WS, tree());
    expect(order).toEqual(['create', 'resolve']);
  });
});

// ============================================================
// C-01 — the row it compares against must be OUR row
// ------------------------------------------------------------
// This is the write half of "one entity can carry more than one open call", and
// the only one of C-01's three sites that CORRUPTS a stored row rather than
// mis-reading one. R-3 lets a Guardrail episode and an Experiment sit open on
// the same entity, and decisionIdentity says in as many words that
// entity + level + status "identifies some campaign-level proposal, which is a
// different and much larger set" than a connector verdict.
//
// Unscoped, `findFirst(..., createdAt desc)` could return a foreign class and
// then do one of two things, both damaging:
//   • verdicts happen to match  → the real verdict is never written
//   • verdicts differ           → resolvePrevious SUPERSEDES the foreign row and
//                                 stamps `resolution` on it — which is exactly
//                                 the write C-02 kept off guardrail closure,
//                                 arriving through the back door.
// ============================================================
// Asserted on the QUERY throughout. The prisma mock returns whatever it is
// handed regardless of the filter, so seeding a guardrail row and watching it
// get superseded would pass identically against a query with no scope at all —
// it would prove the mock's behaviour, not the boundary. Real-row verification
// covers the consequence.
describe('C-01 — the comparison is scoped to connector verdicts', () => {
  it('asks only for connector-authored rows', async () => {
    await persistLevelVerdicts(WS, tree());
    const { where } = prisma.decision.findFirst.mock.calls[0][0];

    expect(where.entityId).toBe(ID);
    expect(where.status).toEqual({ not: 'SUPERSEDED' });
    // Spread from the exported scope rather than restated: a local copy of the
    // taxonomy is what let FUNNEL_SIGNAL go missing elsewhere.
    expect(where).toMatchObject(connectorDecisionScope());
  });

  it('scopes on IDENTITY, not on buyer actionability', async () => {
    // BUYER_ACTIONABLE excludes HOLD and the data-quality causes. Using it here
    // would make those verdicts invisible to the comparison, so they could never
    // be superseded and would accumulate as permanently-open rows — the failure
    // decisionIdentity calls out for exactly this reason.
    await persistLevelVerdicts(WS, tree());
    const { where } = prisma.decision.findFirst.mock.calls[0][0];
    const listed = where.OR.find((c) => Array.isArray(c.rootCause?.in));
    expect(listed.rootCause.in).toEqual(CONNECTOR_ROOT_CAUSES);
  });

  it('admits a null cause — the engine writes one on its early gates', async () => {
    // `rootCause: null` is IN the scope, not an oversight. Dropping it would
    // exclude exactly the campaigns that never got a diagnosis, so their
    // verdicts would never be compared and never superseded.
    await persistLevelVerdicts(WS, tree());
    const { where } = prisma.decision.findFirst.mock.calls[0][0];
    expect(where.OR.some((c) => c.rootCause === null)).toBe(true);
  });
});

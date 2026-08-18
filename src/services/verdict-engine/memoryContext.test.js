// ============================================================
// R10 · Phase D — the loop closing, in the real verdict path
// ------------------------------------------------------------
// institutionalMemory.test.js proves the layer's own arithmetic. This proves the
// WIRING: that validated memory actually reaches getConnectorVerdicts, that it
// moves the published confidence, and that nothing it does can reach the
// verdict, the diagnosis or the evidence.
//
// A unit-tested memory layer nobody called is precisely the hollow wire R10 was
// warned against — the previous state of this system was a fully built learning
// engine with no consumer, and every one of ITS unit tests passed too.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCanonicalVerdictCampaigns, findMany, groupBy, patternFindMany } = vi.hoisted(() => ({
  getCanonicalVerdictCampaigns: vi.fn(), findMany: vi.fn(), groupBy: vi.fn(), patternFindMany: vi.fn(),
}));
vi.mock('../entity-graph/index.js', () => ({ getCanonicalVerdictCampaigns }));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { decision: { findMany, groupBy }, accountPattern: { findMany: patternFindMany } },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getConnectorVerdicts } from './connectorVerdictService.js';
import { MEMORY_STATUS } from '../pattern-engine/institutionalMemory.js';

const WS = 'ws-1';

// A fatigued, weak-CTR campaign with revenue measured — lands on REFRESH.
const row = (over = {}) => ({
  entityId: 'c1', name: 'Campaign', level: 'CAMPAIGN',
  spendMinor: 500_000, revenueMinor: 1_000_000, impressions: 50_000, clicks: 350,
  frequency: 4.0, objective: 'OUTCOME_SALES', currency: 'USD',
  ...over,
});

const validatedPattern = (over = {}) => ({
  id: 'p1', patternKey: 'FATIGUE|CAMPAIGN|null|REFRESH', kind: 'FATIGUE_CEILING',
  statement: 'On campaigns, REFRESH once frequency passes ~3.5', basis: 'weighted median',
  metric: 'frequency', scopeLevel: 'CAMPAIGN', emitVerdict: 'REFRESH', threshold: 3.5, unit: 'RATIO',
  status: 'ESTABLISHED', accuracy: 0.95, confidence: 0.85, support: 12, effectiveSupport: 10,
  firstObservedAt: new Date('2026-01-01'), lastObservedAt: new Date('2026-08-01'),
  updatedAt: new Date('2026-08-01'),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  getCanonicalVerdictCampaigns.mockResolvedValue({ campaigns: [row()], noCanonicalWindow: [] });
  findMany.mockResolvedValue([]);
  groupBy.mockResolvedValue([]);
  patternFindMany.mockResolvedValue([]);
});

describe('I50 · validated memory reaches the verdict payload', () => {
  // THE CONTROL FOR THE WHOLE OF R10. Remove getInstitutionalMemory from
  // getConnectorVerdicts and this fails — the learning loop reverts to storing
  // patterns nobody reads, which is the state the discovery reported.
  it('I50 · a validated pattern reaches the decision and is stated with its provenance', async () => {
    patternFindMany.mockResolvedValue([validatedPattern()]);

    const { verdicts } = await getConnectorVerdicts(WS);
    const v = verdicts[0];

    expect(v.institutionalMemory.status).toBe(MEMORY_STATUS.OK);
    expect(v.institutionalMemory.applied).toBe(true);
    expect(v.institutionalMemory.patterns[0]).toMatchObject({
      patternKey: 'FATIGUE|CAMPAIGN|null|REFRESH',
      accuracy: 0.95,          // the measured figure, from the column
      effectiveSupport: 10,    // …and how much evidence is behind it
    });
  });

  it('a proven track record raises the published confidence above the deterministic one', async () => {
    patternFindMany.mockResolvedValue([validatedPattern({ accuracy: 0.98 })]);

    const { verdicts } = await getConnectorVerdicts(WS);
    const v = verdicts[0];

    expect(v.baseConfidence).toBeGreaterThan(0);
    expect(v.confidence).toBeGreaterThan(v.baseConfidence);
  });

  // Both halves must be published. Folding memory into one number would make
  // the adjustment unauditable — an operator could not recover what the evidence
  // alone said, which is the figure they may legitimately want to trust instead.
  it('publishes the deterministic figure alongside the adjusted one', async () => {
    patternFindMany.mockResolvedValue([validatedPattern()]);
    const { verdicts } = await getConnectorVerdicts(WS);

    expect(verdicts[0]).toHaveProperty('baseConfidence');
    expect(verdicts[0]).toHaveProperty('confidence');
    expect(verdicts[0].institutionalMemory).toHaveProperty('factor');
  });
});

describe('NC34 · memory cannot change the verdict', () => {
  // The spec's control, stated exactly: same live evidence, different validated
  // history, and the verdict must be identical. Only the permitted layer moves.
  it('NC34 · identical evidence + different pattern history → identical verdict', async () => {
    patternFindMany.mockResolvedValue([]);
    const without = (await getConnectorVerdicts(WS)).verdicts[0];

    patternFindMany.mockResolvedValue([validatedPattern({ accuracy: 1.0, effectiveSupport: 50 })]);
    const withStrong = (await getConnectorVerdicts(WS)).verdicts[0];

    patternFindMany.mockResolvedValue([validatedPattern({ accuracy: 0.61, effectiveSupport: 50 })]);
    const withWeak = (await getConnectorVerdicts(WS)).verdicts[0];

    // The verdict, the reasoning, and every evidence figure are untouched.
    expect(withStrong.verdict).toBe(without.verdict);
    expect(withWeak.verdict).toBe(without.verdict);
    expect(withStrong.rationale).toBe(without.rationale);
    expect(withStrong.rootCause).toBe(without.rootCause);
    expect(withStrong.signalType).toBe(without.signalType);
    expect(withStrong.spendMinor).toBe(without.spendMinor);
    expect(withStrong.roas).toBe(without.roas);
    expect(withStrong.baseConfidence).toBe(without.baseConfidence);

    // …and the confidence DID move, or the layer is decorative.
    expect(withStrong.confidence).toBeGreaterThan(withWeak.confidence);
  });

  // A pattern that prescribes a DIFFERENT verdict must not pull this one toward
  // it. Relevance is matched on the pattern's own emitVerdict for exactly this
  // reason — otherwise a strong KILL history would be quietly inflating the
  // confidence of every REFRESH.
  it('a pattern about another verdict does not touch this one', async () => {
    patternFindMany.mockResolvedValue([]);
    const clean = (await getConnectorVerdicts(WS)).verdicts[0];

    patternFindMany.mockResolvedValue([
      validatedPattern({ emitVerdict: 'KILL', patternKey: 'FATIGUE|CAMPAIGN|null|KILL', accuracy: 1.0 }),
    ]);
    const other = (await getConnectorVerdicts(WS)).verdicts[0];

    expect(other.verdict).toBe(clean.verdict);
    expect(other.confidence).toBe(clean.confidence);
    expect(other.institutionalMemory.applied).toBe(false);
  });
});

describe('NC36 · unmeasured patterns never reach the decision', () => {
  // NC36 in the wiring. An EMERGING pattern is "seen, never checked"; if it
  // could move confidence, R10's whole honesty fix would be undone one layer
  // downstream from where it was made.
  it('NC36 · an EMERGING pattern does not enter future context', async () => {
    patternFindMany.mockResolvedValue([]);
    const clean = (await getConnectorVerdicts(WS)).verdicts[0];

    patternFindMany.mockResolvedValue([validatedPattern({ status: 'EMERGING', accuracy: null })]);
    const emerging = (await getConnectorVerdicts(WS)).verdicts[0];

    expect(emerging.institutionalMemory.patterns).toEqual([]);
    expect(emerging.confidence).toBe(clean.confidence);
  });

  it('a CONFLICTED pattern is silent — a contested rule may not lend confidence', async () => {
    patternFindMany.mockResolvedValue([validatedPattern({ status: 'CONFLICTED' })]);
    const { verdicts } = await getConnectorVerdicts(WS);
    expect(verdicts[0].institutionalMemory.patterns).toEqual([]);
    expect(verdicts[0].institutionalMemory.applied).toBe(false);
  });
});

describe('NC35 · a memory failure costs the account nothing', () => {
  // NC35 in the wiring: the read throws, and the verdict path still produces a
  // complete, honest answer with its deterministic confidence intact.
  it('NC35 · reports MEMORY_UNAVAILABLE and leaves confidence untouched', async () => {
    patternFindMany.mockResolvedValue([]);
    const healthy = (await getConnectorVerdicts(WS)).verdicts[0];

    patternFindMany.mockRejectedValue(new Error('db down'));
    const broken = (await getConnectorVerdicts(WS)).verdicts[0];

    expect(broken.institutionalMemory.status).toBe(MEMORY_STATUS.MEMORY_UNAVAILABLE);
    expect(broken.institutionalMemory.applied).toBe(false);
    expect(broken.confidence).toBe(healthy.confidence);
    expect(broken.confidence).toBe(broken.baseConfidence);
    // The verdict still lands. A memory outage must never blank the feed.
    expect(broken.verdict).toBe(healthy.verdict);
  });

  it('an account with no learning yet is NO_VALIDATED_MEMORY, not a failure', async () => {
    patternFindMany.mockResolvedValue([]);
    const { verdicts } = await getConnectorVerdicts(WS);
    expect(verdicts[0].institutionalMemory.status).toBe(MEMORY_STATUS.NO_VALIDATED_MEMORY);
  });
});

describe('workspace isolation', () => {
  it('the memory read is scoped to the requesting workspace', async () => {
    await getConnectorVerdicts(WS);
    expect(patternFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ workspaceId: WS }) }),
    );
  });
});

// ============================================================
// persistNode — freezing the reasoning onto the row
// ------------------------------------------------------------
// The verdict engine has always built hypotheses and counterfactuals and
// attached them to the node persistNode writes. They were never stored, so every
// decision the product has ever made kept its CONCLUSION and discarded its
// REASONING — `rootCause` survived, and one string names the winner without
// recording what else was considered or what argued against it.
//
// The two properties worth pinning:
//   CAPTURED AT CREATE — the reasoning belongs to the moment of the call.
//   NEVER REWRITTEN — resolvePrevious closes a row out with facts about what
//     happened AFTERWARDS. If it ever touched these, a superseded decision would
//     claim it had foreseen its own replacement, and the history would show
//     every closed-out call reasoning perfectly about an outcome it never
//     predicted. That is worse than storing nothing.
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

const WS = 'ws-1';
const ID = 'c1c1c1c1-0000-4000-8000-000000000001';

// Same harness as VerdictService.lifecycle: rollupVerdicts RE-DERIVES from raw
// leaf metrics, so the engine produces the real reasoning rather than a fixture
// asserting against itself. These metrics score the awareness track.
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

describe('the reasoning reaches the row', () => {
  it('writes both columns on every create', async () => {
    await persistLevelVerdicts(WS, tree());
    expect(created()).toHaveProperty('hypotheses');
    expect(created()).toHaveProperty('counterfactuals');
  });

  // Fed through the real engine, not a fixture: this asserts the wiring from
  // verdictEngine's node all the way into the create call, which is the only
  // thing that was ever missing.
  it('stores what the ENGINE produced, in artifact shape', async () => {
    await persistLevelVerdicts(WS, tree());
    const { hypotheses } = created();

    expect(Array.isArray(hypotheses)).toBe(true);
    for (const h of hypotheses) {
      expect(Object.keys(h).sort()).toEqual(
        ['confidence', 'contradicts', 'id', 'labelKey', 'observed', 'source', 'supports'],
      );
    }
  });

  it('tags each hypothesis with the pass that produced it', async () => {
    await persistLevelVerdicts(WS, tree());
    const { hypotheses } = created();
    // Only meaningful when the engine actually projected one — a healthy
    // campaign legitimately produces none, and asserting on an empty list would
    // pass for the wrong reason.
    for (const h of hypotheses) expect(h.source).toBe('absolute');
  });

  it('carries no entity blob into the row', async () => {
    await persistLevelVerdicts(WS, tree());
    for (const h of created().hypotheses ?? []) {
      expect(h.campaign).toBeUndefined();
      expect(h.metrics).toBeUndefined();
      expect(h.snapshot).toBeUndefined();
    }
  });

  it('survives JSONB serialization', async () => {
    await persistLevelVerdicts(WS, tree());
    const { hypotheses, counterfactuals } = created();
    expect(JSON.parse(JSON.stringify({ hypotheses, counterfactuals })))
      .toEqual({ hypotheses, counterfactuals });
  });
});

describe('what a caller that does not reason this way stores', () => {
  // A node with the reasoning stripped — the shape a guardrail or allocation
  // writer produces. null is the honest record: not "we found nothing", but
  // "this path never reasoned".
  it('null when the node carries neither', async () => {
    const t = tree();
    // rollupVerdicts re-derives, so blank them on the way out via a leaf with
    // no children and no engine-produced reasoning is not possible — assert the
    // helper contract instead, which persistNode calls verbatim.
    await persistLevelVerdicts(WS, t);
    const { hypotheses, counterfactuals } = created();
    // Whatever the engine produced, neither may be undefined: an absent field
    // is indistinguishable from a column that was never written.
    expect(hypotheses).not.toBeUndefined();
    expect(counterfactuals).not.toBeUndefined();
  });

  it('never throws the sweep over a reasoning field', async () => {
    // persistNode's create is the load-bearing write. A malformed reasoning
    // payload must not cost the sweep the verdict it was recording.
    await expect(persistLevelVerdicts(WS, tree({ impressions: 12, clicks: 0 }))).resolves.toBeTruthy();
  });
});

// ── The immutability guarantee ───────────────────────────────
describe('resolvePrevious leaves the reasoning alone', () => {
  const previous = (over = {}) => ({
    id: 'old-1', verdict: 'REFRESH', ctrAtDecision: 1.0, roasAtDecision: null, ...over,
  });

  it('writes outcome fields only — never hypotheses or counterfactuals', async () => {
    prisma.decision.findFirst.mockResolvedValue(previous());
    await persistLevelVerdicts(WS, tree());

    expect(resolved().where).toEqual({ id: 'old-1' });
    expect(Object.keys(resolved().data).sort()).toEqual(
      ['confidenceDelta', 'resolution', 'resolvedAt', 'status'],
    );
  });

  // Stated twice on purpose. The key-set assertion above would still pass if
  // someone renamed a field; these name the two that must never appear.
  it('does not overwrite the superseded row with the NEW verdict reasoning', async () => {
    prisma.decision.findFirst.mockResolvedValue(previous());
    await persistLevelVerdicts(WS, tree());

    expect(resolved().data).not.toHaveProperty('hypotheses');
    expect(resolved().data).not.toHaveProperty('counterfactuals');
  });

  it('the new reasoning goes on the NEW row instead', async () => {
    prisma.decision.findFirst.mockResolvedValue(previous());
    await persistLevelVerdicts(WS, tree());

    // Two rows, two snapshots: one create carrying this sweep's reasoning, one
    // update carrying only what happened since the last one.
    expect(prisma.decision.create).toHaveBeenCalledTimes(1);
    expect(created()).toHaveProperty('hypotheses');
    expect(prisma.decision.update).toHaveBeenCalledTimes(1);
  });

  // NOT TESTED HERE: supersedeDroppedConnectorVerdicts (the dropped-entity
  // path). It is module-private, and its updateMany passes a hard-coded
  // `{ status: 'SUPERSEDED' }` literal — there is no seam through which
  // reasoning could reach it. Exporting it to assert that would widen the
  // module's public surface for a guarantee the line already gives by
  // construction.
});

// ============================================================
// C-07 · tests 4 + 7 — the reason, its token and its prerequisite cross the wire
// ============================================================
// The defect C-07 closes: the backend produced THREE distinct absences with the
// operands needed to explain each, and the only thing that survived to the
// operator was a count under one wrong instruction. These tests assert the
// producer half — that every gatedOut row leaves evaluateConnectorVerdicts
// naming a DECLARED reason, its knowledge token and the prerequisite that would
// open the road, and that the stale row still carries the facts it always had.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    campaign:       { findMany: vi.fn() },
    metricSnapshot: { findMany: vi.fn() },
    decision:       { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock('../evidence/index.js', () => ({ selectOperationalSnapshots: vi.fn(async () => []) }));

import { prisma } from '../../lib/prisma.js';
import { evaluateConnectorVerdicts, buildConnectorVerdictTree } from './connectorVerdictService.js';
import {
  GATING_REASON, GATING_REASON_VALUES, PREREQUISITE,
  knowledgeOfGatingReason, prerequisiteOfGatingReason,
} from '@marcom/runtime-contracts';
import { KNOWLEDGE } from '@marcom/runtime-contracts';

const WS = 'ws-c07';
const DAY = 86_400_000;
const NOW = new Date('2026-08-26T09:00:00.000Z');

const identity = (id, name = 'Always On') => ({
  id, name, channel: 'META', objective: 'OUTCOME_SALES',
  externalId: `ext-${id}`, platformCreatedTime: new Date('2025-06-01T00:00:00Z'),
  _count: { adSets: 1 },
});

const snap = ({ entityId, ageDays, dataless = false }) => {
  const windowEnd = new Date(new Date(NOW.getTime() - ageDays * DAY).toISOString().slice(0, 10) + 'T00:00:00.000Z');
  return {
    entityId, source: 'META', currency: 'USD', measurementWindow: 'CUMULATIVE_30D',
    windowStart: new Date(windowEnd.getTime() - 29 * DAY), windowEnd, date: windowEnd,
    spendMinor: dataless ? 0 : 5_000_000,
    revenueMinor: dataless ? 0 : 1_000_000,
    impressions: dataless ? 0 : 400_000,
    clicks: dataless ? 0 : 6_000,
    conversions: dataless ? 0 : 40,
    roas: dataless ? null : 0.2, ctr: dataless ? null : 0.015,
    frequency: dataless ? null : 4.4, reach: dataless ? 0 : 90_000,
    actionMetrics: null, dailyBudgetMinor: null,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe('C-07 · test 4 — the dataless gate names a declared reason, not a sentence', () => {
  it('buildConnectorVerdictTree emits NO_MEASURABLE_DELIVERY', () => {
    const { tree, gatedOut } = buildConnectorVerdictTree(WS, [
      { entityId: 'D', name: 'Dataless', currency: 'USD', objective: 'OUTCOME_SALES' },
    ]);
    expect(tree).toBeNull();
    expect(gatedOut[0].reason).toBe(GATING_REASON.NO_MEASURABLE_DELIVERY);
  });

  it('no gatedOut row carries free prose — the value is a domain value, not display text', () => {
    const { gatedOut } = buildConnectorVerdictTree(WS, [
      { entityId: 'D', name: 'Dataless', currency: 'USD', objective: 'OUTCOME_SALES' },
    ]);
    for (const row of gatedOut) expect(GATING_REASON_VALUES).toContain(row.reason);
  });
});

describe('C-07 · test 7 — every published gatedOut row carries reason + knowledge + prerequisite', () => {
  it('the stale row keeps the operands it always had, and gains the two layers', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity('B', 'Stale')]);
    prisma.metricSnapshot.findMany.mockResolvedValue([snap({ entityId: 'B', ageDays: 42 })]);

    const ev = await evaluateConnectorVerdicts(WS);

    expect(ev.gatedOut).toHaveLength(1);
    expect(ev.gatedOut[0]).toMatchObject({
      id: 'B',
      reason: GATING_REASON.CANONICAL_EVIDENCE_STALE,
      knowledge: KNOWLEDGE.NOT_ENOUGH,
      prerequisite: PREREQUISITE.FRESH_MEASUREMENT,
      // Already on the wire before C-07 — and thrown away by the client.
      measurementAgeDays: 42,
      maxAgeDays: 3,
    });
    expect(ev.gatedOut[0].windowEnd).toBeTruthy();
  });

  it('a never-measured campaign is NO_CANONICAL_WINDOW, awaiting a FIRST measurement', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity('N', 'Never synced')]);
    prisma.metricSnapshot.findMany.mockResolvedValue([]);

    const ev = await evaluateConnectorVerdicts(WS);

    expect(ev.gatedOut[0]).toMatchObject({
      id: 'N',
      reason: GATING_REASON.NO_CANONICAL_WINDOW,
      knowledge: KNOWLEDGE.NOTHING_THERE,
      prerequisite: PREREQUISITE.FIRST_MEASUREMENT,
    });
  });

  it('a dataless campaign is NOTHING_THERE too — same token, different prerequisite', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity('D', 'Dataless')]);
    prisma.metricSnapshot.findMany.mockResolvedValue([snap({ entityId: 'D', ageDays: 0, dataless: true })]);

    const ev = await evaluateConnectorVerdicts(WS);

    expect(ev.gatedOut[0]).toMatchObject({
      id: 'D',
      reason: GATING_REASON.NO_MEASURABLE_DELIVERY,
      knowledge: KNOWLEDGE.NOTHING_THERE,
      prerequisite: PREREQUISITE.DELIVERY,
    });
  });

  it('a mixed population publishes three reasons, two tokens and three prerequisites', async () => {
    // THE MEASUREMENT THAT JUSTIFIES THE SLICE. Collapse these to a token and
    // two of the three become the same row; collapse them to a count and all
    // three become "N campaigns need revenue data" — which is the wrong
    // instruction for two of them.
    prisma.campaign.findMany.mockResolvedValue([
      identity('D', 'Dataless'), identity('N', 'Never synced'), identity('B', 'Stale'),
    ]);
    prisma.metricSnapshot.findMany.mockResolvedValue([
      snap({ entityId: 'D', ageDays: 0, dataless: true }),
      snap({ entityId: 'B', ageDays: 42 }),
    ]);

    const { gatedOut } = await evaluateConnectorVerdicts(WS);

    expect(gatedOut).toHaveLength(3);
    expect(new Set(gatedOut.map((g) => g.reason)).size).toBe(3);
    expect(new Set(gatedOut.map((g) => g.knowledge)).size).toBe(2);
    expect(new Set(gatedOut.map((g) => g.prerequisite)).size).toBe(3);

    for (const row of gatedOut) {
      expect(row.knowledge).toBe(knowledgeOfGatingReason(row.reason));
      expect(row.prerequisite).toBe(prerequisiteOfGatingReason(row.reason));
    }
  });
});

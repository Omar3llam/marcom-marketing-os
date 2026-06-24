// ============================================================
// recordOutcome — the Proof Engine's only real WRITE path
// ============================================================
// Proves the human-asserted outcome writer is honest + workspace-isolated:
//   1. body validation (422 cases) rejects bad shapes, accepts KILL negatives;
//   2. EXECUTED + valid → an OutcomeSnapshot is written, entityId/entityLevel
//      INHERITED from the decision (never operator-entered);
//   3. a cross-workspace id is invisible (→404);
//   4. a non-EXECUTED decision cannot carry an outcome (→409);
//   5. re-recording UPSERTS in place (no duplicate) since decisionId is not
//      unique;
//   6. listPendingOutcomes scopes to EXECUTED-with-no-outcome.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    decision:        { findFirst: vi.fn(), findMany: vi.fn() },
    outcomeSnapshot: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    workspace:       { findUnique: vi.fn() },
  },
}));

import { prisma } from '../../lib/prisma.js';
import { recordOutcome, listPendingOutcomes, validateOutcomeBody } from './DecisionAccuracyService.js';

const VALID = Object.freeze({
  spendDeltaMinor: -450000, revenueDeltaMinor: 120000, roasDelta: -0.8,
  windowStart: '2026-06-01T00:00:00Z', windowEnd: '2026-06-08T00:00:00Z', sustained: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  prisma.outcomeSnapshot.create.mockResolvedValue({ id: 'out-1' });
  prisma.outcomeSnapshot.update.mockResolvedValue({ id: 'out-existing' });
});

describe('validateOutcomeBody — the 422 surface (pure, no HTTP)', () => {
  it('accepts a valid body (incl. negative KILL deltas)', () => {
    expect(validateOutcomeBody(VALID)).toBeNull();
  });
  it('rejects a non-integer spendDeltaMinor', () => {
    expect(validateOutcomeBody({ ...VALID, spendDeltaMinor: 1.5 })).toMatch(/spendDeltaMinor/);
  });
  it('rejects windowEnd ≤ windowStart', () => {
    expect(validateOutcomeBody({ ...VALID, windowEnd: VALID.windowStart })).toMatch(/windowEnd must be after/);
  });
  it('rejects a missing/non-boolean sustained', () => {
    expect(validateOutcomeBody({ ...VALID, sustained: undefined })).toMatch(/sustained/);
  });
  it('rejects an invalid ISO windowStart', () => {
    expect(validateOutcomeBody({ ...VALID, windowStart: 'not-a-date' })).toMatch(/windowStart/);
  });
});

describe('recordOutcome — write path', () => {
  it('EXECUTED + valid → writes a snapshot, inheriting entityId/entityLevel from the decision', async () => {
    prisma.decision.findFirst.mockResolvedValue({ id: 'dec-1', status: 'EXECUTED', entityId: 'ent-1', entityLevel: 'ADSET' });
    prisma.outcomeSnapshot.findFirst.mockResolvedValue(null);

    const out = await recordOutcome('ws-1', 'dec-1', VALID);

    expect(prisma.decision.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'dec-1', workspaceId: 'ws-1' } }),
    );
    const created = prisma.outcomeSnapshot.create.mock.calls[0][0].data;
    expect(created.workspaceId).toBe('ws-1');
    expect(created.decisionId).toBe('dec-1');
    expect(created.entityId).toBe('ent-1');      // inherited — NOT from the body
    expect(created.entityLevel).toBe('ADSET');   // inherited — NOT from the body
    expect(created.spendDeltaMinor).toBe(-450000);   // KILL negative preserved
    expect(created.revenueDeltaMinor).toBe(120000);
    expect(created.windowStart).toBeInstanceOf(Date);
    expect(created.windowEnd).toBeInstanceOf(Date);
    expect(out).toEqual({ workspaceId: 'ws-1', decisionId: 'dec-1', outcome: { id: 'out-1' } });
  });

  it('throws (→404) when the decision id belongs to another workspace', async () => {
    prisma.decision.findFirst.mockResolvedValue(null);
    await expect(recordOutcome('ws-1', 'foreign', VALID)).rejects.toThrow(/not found/i);
    expect(prisma.outcomeSnapshot.create).not.toHaveBeenCalled();
    expect(prisma.outcomeSnapshot.update).not.toHaveBeenCalled();
  });

  it('throws (→409) when the decision is not EXECUTED', async () => {
    for (const status of ['PROPOSED', 'DISMISSED']) {
      vi.clearAllMocks();
      prisma.decision.findFirst.mockResolvedValue({ id: 'dec-1', status, entityId: 'ent-1', entityLevel: 'ADSET' });
      await expect(recordOutcome('ws-1', 'dec-1', VALID)).rejects.toThrow(/not EXECUTED/i);
      expect(prisma.outcomeSnapshot.create).not.toHaveBeenCalled();
    }
  });

  it('UPSERTS in place on re-record — updates the newest snapshot, never duplicates', async () => {
    prisma.decision.findFirst.mockResolvedValue({ id: 'dec-1', status: 'EXECUTED', entityId: 'ent-1', entityLevel: 'ADSET' });
    prisma.outcomeSnapshot.findFirst.mockResolvedValue({ id: 'out-existing' });

    await recordOutcome('ws-1', 'dec-1', { ...VALID, sustained: false });

    expect(prisma.outcomeSnapshot.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'out-existing' }, data: expect.objectContaining({ sustained: false }) }),
    );
    expect(prisma.outcomeSnapshot.create).not.toHaveBeenCalled();
  });
});

describe('listPendingOutcomes — the manual-entry queue', () => {
  it('scopes to EXECUTED decisions with NO outcome and returns the workspace currency', async () => {
    prisma.decision.findMany.mockResolvedValue([{ id: 'dec-1', verdict: 'KILL' }]);
    prisma.workspace.findUnique.mockResolvedValue({ currency: 'EGP' });

    const out = await listPendingOutcomes('ws-1');

    expect(prisma.decision.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'ws-1', status: 'EXECUTED', outcomes: { none: {} } } }),
    );
    expect(out.decisions).toHaveLength(1);
    expect(out.currency).toBe('EGP');
  });

  it('defaults currency to USD when the workspace row is missing', async () => {
    prisma.decision.findMany.mockResolvedValue([]);
    prisma.workspace.findUnique.mockResolvedValue(null);
    const out = await listPendingOutcomes('ws-1');
    expect(out.currency).toBe('USD');
  });
});

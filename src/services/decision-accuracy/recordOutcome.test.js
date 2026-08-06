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

// A decision a human said they acted on. `status` stays PROPOSED because the
// human-signal routes deliberately do not move it — the timestamp is the fact.
const executed = (over = {}) => ({
  id: 'dec-1', status: 'PROPOSED', entityId: 'ent-1', entityLevel: 'ADSET',
  executedAt: new Date('2026-08-01T10:00:00.000Z'), dismissedAt: null, ...over,
});

describe('recordOutcome — write path', () => {
  it('executed + valid → writes a snapshot, inheriting entityId/entityLevel from the decision', async () => {
    prisma.decision.findFirst.mockResolvedValue(executed());
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

  it('throws (→409) when nobody ever said they acted', async () => {
    prisma.decision.findFirst.mockResolvedValue(executed({ executedAt: null }));
    await expect(recordOutcome('ws-1', 'dec-1', VALID)).rejects.toThrow(/has not been executed/i);
    expect(prisma.outcomeSnapshot.create).not.toHaveBeenCalled();
  });

  it('throws (→409) on a DISMISSED decision, and says which state it is in', async () => {
    // Not the same refusal. A dismissal has no outcome by construction — nothing
    // was done, so nothing followed. Collapsing the two messages would send an
    // operator looking for a missing execution record that will never exist.
    prisma.decision.findFirst.mockResolvedValue(
      executed({ executedAt: null, dismissedAt: new Date('2026-08-01T10:00:00.000Z') }),
    );
    await expect(recordOutcome('ws-1', 'dec-1', VALID)).rejects.toThrow(/was dismissed, not executed/i);
    expect(prisma.outcomeSnapshot.create).not.toHaveBeenCalled();
  });

  // The guard reads executedAt, so the select MUST ask for it. Testing a field
  // that was never selected is how this check would silently invert: undefined
  // fails the guard for every decision, and the write path dies for all of them.
  it('selects the timestamps its own guard reads', async () => {
    prisma.decision.findFirst.mockResolvedValue(executed());
    prisma.outcomeSnapshot.findFirst.mockResolvedValue(null);
    await recordOutcome('ws-1', 'dec-1', VALID);
    expect(prisma.decision.findFirst.mock.calls[0][0].select)
      .toMatchObject({ executedAt: true, dismissedAt: true });
  });

  // status is no longer consulted at all: the routes leave it PROPOSED, and a
  // decision superseded after being acted on must still accept its outcome.
  it.each([['PROPOSED'], ['SUPERSEDED']])('accepts an executed decision whose status is %s', async (status) => {
    prisma.decision.findFirst.mockResolvedValue(executed({ status }));
    prisma.outcomeSnapshot.findFirst.mockResolvedValue(null);
    await expect(recordOutcome('ws-1', 'dec-1', VALID)).resolves.toBeTruthy();
  });

  it('UPSERTS in place on re-record — updates the newest snapshot, never duplicates', async () => {
    prisma.decision.findFirst.mockResolvedValue(executed());
    prisma.outcomeSnapshot.findFirst.mockResolvedValue({ id: 'out-existing' });

    await recordOutcome('ws-1', 'dec-1', { ...VALID, sustained: false });

    expect(prisma.outcomeSnapshot.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'out-existing' }, data: expect.objectContaining({ sustained: false }) }),
    );
    expect(prisma.outcomeSnapshot.create).not.toHaveBeenCalled();
  });
});

describe('listPendingOutcomes — the manual-entry queue', () => {
  it('scopes to executed-but-unrecorded decisions and returns the workspace currency', async () => {
    prisma.decision.findMany.mockResolvedValue([{ id: 'dec-1', verdict: 'KILL' }]);
    prisma.workspace.findUnique.mockResolvedValue({ currency: 'EGP' });

    const out = await listPendingOutcomes('ws-1');

    expect(prisma.decision.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: 'ws-1',
          executedAt: { not: null },
          dismissedAt: null,
          outcomes: { none: {} },
        },
      }),
    );
    expect(out.decisions).toHaveLength(1);
    expect(out.currency).toBe('EGP');
  });

  it('excludes dismissals — nothing was done, so nothing followed from it', async () => {
    prisma.decision.findMany.mockResolvedValue([]);
    prisma.workspace.findUnique.mockResolvedValue({ currency: 'USD' });
    await listPendingOutcomes('ws-1');
    expect(prisma.decision.findMany.mock.calls[0][0].where.dismissedAt).toBeNull();
  });

  it('does NOT scope on status — a decision superseded after being acted on still owes an outcome', async () => {
    prisma.decision.findMany.mockResolvedValue([]);
    prisma.workspace.findUnique.mockResolvedValue({ currency: 'USD' });
    await listPendingOutcomes('ws-1');
    expect(prisma.decision.findMany.mock.calls[0][0].where.status).toBeUndefined();
  });

  // A work queue, ordered by the debt it represents. Oldest EXECUTION first, not
  // oldest issuance: once operators act out of order the two disagree, and
  // `createdAt: desc` actively buried the most overdue rows past the take:100.
  it('orders by oldest execution first', async () => {
    prisma.decision.findMany.mockResolvedValue([]);
    prisma.workspace.findUnique.mockResolvedValue({ currency: 'USD' });
    await listPendingOutcomes('ws-1');
    expect(prisma.decision.findMany.mock.calls[0][0].orderBy).toEqual({ executedAt: 'asc' });
  });

  it('defaults currency to USD when the workspace row is missing', async () => {
    prisma.decision.findMany.mockResolvedValue([]);
    prisma.workspace.findUnique.mockResolvedValue(null);
    const out = await listPendingOutcomes('ws-1');
    expect(out.currency).toBe('USD');
  });
});

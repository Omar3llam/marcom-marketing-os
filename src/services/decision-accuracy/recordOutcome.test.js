// ============================================================
// recordOutcome — the Proof Engine's only real WRITE path
// ============================================================
// Proves the human-asserted outcome writer is honest + workspace-isolated:
//   1. body validation (422 cases) rejects bad shapes, accepts KILL negatives;
//   2. EXECUTED + valid → an OutcomeSnapshot is written, entityId/entityLevel
//      INHERITED from the decision (never operator-entered);
//   3. a cross-workspace id is invisible (→404);
//   4. a non-EXECUTED decision cannot carry an outcome (→409);
//   5. re-recording APPENDS and supersedes — the previous result keeps every
//      value it was recorded with (R6 · I19);
//   6. the measured period is anchored to the execution and cannot reach into
//      the future;
//   7. provenance is projected server-side, never accepted from the caller;
//   8. listPendingOutcomes scopes to EXECUTED-with-no-CURRENT-outcome.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    decision:        { findFirst: vi.fn(), findMany: vi.fn() },
    outcomeSnapshot: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    workspace:       { findUnique: vi.fn() },
    $transaction:    vi.fn(),
  },
}));
// The projector has its own file of tests, and the SEAM between it and this
// writer has its own file too (outcomeProvenance.seam.test.js). Here it is a
// sentinel: these tests are about what the write path does with provenance, not
// about how provenance is derived.
const PROVENANCE = Object.freeze({
  population: 'operational', selector: 'selectOperationalSnapshots', measurementWindow: 'ROLLING_WINDOW',
  sources: ['META'], observedAt: ['2026-06-03T06:00:00.000Z'], reduction: 'series',
  entityIds: ['ent-1'], rowCount: 4, refs: [],
});
const { projectOutcomeEvidence } = vi.hoisted(() => ({ projectOutcomeEvidence: vi.fn() }));
vi.mock('./outcomeEvidence.js', () => ({ projectOutcomeEvidence }));

import { prisma } from '../../lib/prisma.js';
import {
  recordOutcome, listPendingOutcomes, validateOutcomeBody, getAccuracy, OUTCOME_ERROR,
} from './DecisionAccuracyService.js';

const NOW = new Date('2026-06-20T12:00:00.000Z');

const VALID = Object.freeze({
  spendDeltaMinor: -450000, revenueDeltaMinor: 120000, roasDelta: -0.8,
  windowStart: '2026-06-02T00:00:00Z', windowEnd: '2026-06-09T00:00:00Z',
  sustained: true, measuredAt: '2026-06-10T00:00:00Z',
});

// A decision a human said they acted on. `status` stays PROPOSED because the
// human-signal routes deliberately do not move it — the timestamp is the fact.
const executed = (over = {}) => ({
  id: 'dec-1', status: 'PROPOSED', entityId: 'ent-1', entityLevel: 'ADSET',
  humanExecutedAt: new Date('2026-06-01T10:00:00.000Z'), dismissedAt: null, ...over,
});

const record = (input = VALID, over = {}) => recordOutcome('ws-1', 'dec-1', input, { now: NOW, ...over });
const createdData = () => prisma.outcomeSnapshot.create.mock.calls[0][0].data;

beforeEach(() => {
  vi.clearAllMocks();
  prisma.outcomeSnapshot.create.mockResolvedValue({ id: 'out-new' });
  prisma.outcomeSnapshot.update.mockResolvedValue({ id: 'out-old' });
  prisma.outcomeSnapshot.findFirst.mockResolvedValue(null);
  prisma.decision.findFirst.mockResolvedValue(executed());
  projectOutcomeEvidence.mockResolvedValue({ ...PROVENANCE });
  // One interactive transaction; the mock hands the write path the same client.
  prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
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

  // R6 (I19): required, and never defaulted. Every available substitute is a
  // different fact — `now` would date the measurement to the request, createdAt
  // to the row — so the only honest resolution for a missing one is to ask.
  it('rejects a missing measuredAt rather than filling one in', () => {
    const { measuredAt, ...withoutIt } = VALID;
    expect(measuredAt).toBeTruthy();
    expect(validateOutcomeBody(withoutIt)).toMatch(/measuredAt/);
  });
  it('rejects an unparseable measuredAt', () => {
    expect(validateOutcomeBody({ ...VALID, measuredAt: 'last tuesday' })).toMatch(/measuredAt/);
  });
});

describe('recordOutcome — write path', () => {
  it('executed + valid → writes a snapshot, inheriting entityId/entityLevel from the decision', async () => {
    const out = await record();

    expect(prisma.decision.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'dec-1', workspaceId: 'ws-1' } }),
    );
    const created = createdData();
    expect(created.workspaceId).toBe('ws-1');
    expect(created.decisionId).toBe('dec-1');
    expect(created.entityId).toBe('ent-1');      // inherited — NOT from the body
    expect(created.entityLevel).toBe('ADSET');   // inherited — NOT from the body
    expect(created.spendDeltaMinor).toBe(-450000);   // KILL negative preserved
    expect(created.revenueDeltaMinor).toBe(120000);
    expect(created.windowStart).toBeInstanceOf(Date);
    expect(created.windowEnd).toBeInstanceOf(Date);
    expect(out).toEqual({
      workspaceId: 'ws-1', decisionId: 'dec-1', outcome: { id: 'out-new' }, previousOutcomeId: null,
    });
  });

  it('throws (→404) when the decision id belongs to another workspace', async () => {
    prisma.decision.findFirst.mockResolvedValue(null);
    await expect(recordOutcome('ws-1', 'foreign', VALID, { now: NOW })).rejects.toThrow(/not found/i);
    expect(prisma.outcomeSnapshot.create).not.toHaveBeenCalled();
    expect(prisma.outcomeSnapshot.update).not.toHaveBeenCalled();
  });

  it('throws (→409) when nobody ever said they acted', async () => {
    prisma.decision.findFirst.mockResolvedValue(executed({ humanExecutedAt: null }));
    await expect(record()).rejects.toThrow(/has not been executed/i);
    expect(prisma.outcomeSnapshot.create).not.toHaveBeenCalled();
  });

  it('throws (→409) on a DISMISSED decision, and says which state it is in', async () => {
    // Not the same refusal. A dismissal has no outcome by construction — nothing
    // was done, so nothing followed. Collapsing the two messages would send an
    // operator looking for a missing execution record that will never exist.
    prisma.decision.findFirst.mockResolvedValue(
      executed({ humanExecutedAt: null, dismissedAt: new Date('2026-06-01T10:00:00.000Z') }),
    );
    await expect(record()).rejects.toThrow(/was dismissed, not executed/i);
    expect(prisma.outcomeSnapshot.create).not.toHaveBeenCalled();
  });

  // The refusals carry CODES, because the route used to sniff /not EXECUTED/i
  // against a message reading "has not been executed" — the two never met, and
  // an unexecuted decision returned 500 where the contract says 409.
  it('names each refusal with a code the route can map without reading English', async () => {
    prisma.decision.findFirst.mockResolvedValue(null);
    await expect(record()).rejects.toMatchObject({ code: OUTCOME_ERROR.DECISION_NOT_FOUND });

    prisma.decision.findFirst.mockResolvedValue(executed({ humanExecutedAt: null }));
    await expect(record()).rejects.toMatchObject({ code: OUTCOME_ERROR.NOT_EXECUTED });
  });

  // The guard reads humanExecutedAt, so the select MUST ask for it. Testing a field
  // that was never selected is how this check would silently invert: undefined
  // fails the guard for every decision, and the write path dies for all of them.
  it('selects the timestamps its own guard reads', async () => {
    await record();
    expect(prisma.decision.findFirst.mock.calls[0][0].select)
      .toMatchObject({ humanExecutedAt: true, dismissedAt: true });
  });

  // status is no longer consulted at all: the routes leave it PROPOSED, and a
  // decision superseded after being acted on must still accept its outcome.
  it.each([['PROPOSED'], ['SUPERSEDED']])('accepts an executed decision whose status is %s', async (status) => {
    prisma.decision.findFirst.mockResolvedValue(executed({ status }));
    await expect(record()).resolves.toBeTruthy();
  });
});

describe('R6 — measuredAt is its own fact', () => {
  it('persists the operator\'s measurement instant, as given', async () => {
    await record();
    expect(createdData().measuredAt).toEqual(new Date('2026-06-10T00:00:00Z'));
  });

  it('does not substitute the clock, the window or the execution for it', async () => {
    // The four timestamps this row can carry are four different facts. Any
    // substitution here would answer "when was this measured?" with "when was it
    // typed", "when did the period end", or "when did the operator act".
    await record();
    const created = createdData();
    expect(created.measuredAt).not.toEqual(NOW);
    expect(created.measuredAt).not.toEqual(created.windowEnd);
    expect(created.measuredAt).not.toEqual(executed().humanExecutedAt);
    // …and createdAt is not written at all — the column defaults in the database,
    // which is what keeps "written" and "measured" from ever being the same value
    // by construction.
    expect(created.createdAt).toBeUndefined();
  });
});

describe('R6 — the measured period is anchored to the action', () => {
  it('refuses a window that opens before the decision was executed', async () => {
    const err = await record({ ...VALID, windowStart: '2026-05-20T00:00:00Z' }).catch((e) => e);
    expect(err.code).toBe(OUTCOME_ERROR.INVALID_WINDOW);
    // B4-A — "acted on", not "executed": the anchor is the intervention
    // instant from either provenance, so the wording no longer implies which.
    expect(err.message).toMatch(/before the decision was acted on/);
    expect(prisma.outcomeSnapshot.create).not.toHaveBeenCalled();
  });

  it('refuses a window that closes in the future', async () => {
    const err = await record({ ...VALID, windowEnd: '2026-07-01T00:00:00Z' }).catch((e) => e);
    expect(err.code).toBe(OUTCOME_ERROR.INVALID_WINDOW);
    expect(err.message).toMatch(/in the future/);
    expect(prisma.outcomeSnapshot.create).not.toHaveBeenCalled();
  });

  it('refuses a measurement instant in the future', async () => {
    const err = await record({ ...VALID, measuredAt: '2026-06-25T00:00:00Z' }).catch((e) => e);
    expect(err.code).toBe(OUTCOME_ERROR.INVALID_WINDOW);
    expect(err.message).toMatch(/measuredAt/);
    expect(prisma.outcomeSnapshot.create).not.toHaveBeenCalled();
  });

  it('uses SERVER time — a client that could name `now` could clear the check', async () => {
    // Same body, same window; only the injected server clock differs. The window
    // that was refused above is accepted once the server itself is past it.
    const late = new Date('2026-07-02T00:00:00.000Z');
    await expect(
      recordOutcome('ws-1', 'dec-1', { ...VALID, windowEnd: '2026-07-01T00:00:00Z' }, { now: late }),
    ).resolves.toBeTruthy();
  });

  it('accepts a window opening exactly at the execution and closing exactly now', async () => {
    await expect(record({
      ...VALID,
      windowStart: executed().humanExecutedAt.toISOString(),
      windowEnd: NOW.toISOString(),
      measuredAt: NOW.toISOString(),
    })).resolves.toBeTruthy();
  });
});

describe('R6 — provenance is projected, never accepted', () => {
  it('asks the projector about the decision\'s entity over the measured period', async () => {
    await record();
    expect(projectOutcomeEvidence).toHaveBeenCalledWith('ws-1', {
      entityId: 'ent-1',
      entityLevel: 'ADSET',
      windowStart: new Date(VALID.windowStart),
      windowEnd: new Date(VALID.windowEnd),
    });
  });

  it('persists the projected reference on the row', async () => {
    await record();
    expect(createdData().evidenceReference).toEqual(PROVENANCE);
  });

  it('ignores a caller-supplied evidenceReference — the browser cannot see the rows', async () => {
    const forged = { population: 'canonical-verdict', sources: ['GOOGLE'], rowCount: 999 };
    await record({ ...VALID, evidenceReference: forged });
    expect(createdData().evidenceReference).toEqual(PROVENANCE);
    expect(createdData().evidenceReference).not.toEqual(forged);
  });

  it('writes NOTHING when provenance cannot be established', async () => {
    // I19 refuses the recording rather than writing a row whose null reference
    // would be indistinguishable from a legacy one. The operator's numbers are
    // still in the form; a retry is cheaper than an outcome that quietly claims
    // to have no evidence when the truth is that we failed to look.
    projectOutcomeEvidence.mockRejectedValue(new Error('evidence read failed'));
    await expect(record()).rejects.toThrow(/evidence read failed/);
    expect(prisma.outcomeSnapshot.create).not.toHaveBeenCalled();
    expect(prisma.outcomeSnapshot.update).not.toHaveBeenCalled();
  });
});

describe('R6 — recording appends; it never overwrites', () => {
  it('creates a NEW row and retires the previous one', async () => {
    prisma.outcomeSnapshot.findFirst.mockResolvedValue({ id: 'out-old' });

    const out = await record({ ...VALID, sustained: false });

    expect(prisma.outcomeSnapshot.create).toHaveBeenCalledTimes(1);
    expect(createdData().sustained).toBe(false);
    expect(prisma.outcomeSnapshot.update).toHaveBeenCalledWith({
      where: { id: 'out-old' },
      data: { supersededAt: NOW, supersededById: 'out-new' },
    });
    expect(out.previousOutcomeId).toBe('out-old');
  });

  it('touches NO value on the row it retires — not a delta, not the window, not the provenance', async () => {
    // The immutability assertion, stated as an exhaustive key check rather than a
    // sample: a future edit that added one field to this update would otherwise
    // rewrite history and pass.
    prisma.outcomeSnapshot.findFirst.mockResolvedValue({ id: 'out-old' });
    await record();
    const data = prisma.outcomeSnapshot.update.mock.calls[0][0].data;
    expect(Object.keys(data).sort()).toEqual(['supersededAt', 'supersededById']);
  });

  it('never updates anything on a first recording', async () => {
    await record();
    expect(prisma.outcomeSnapshot.update).not.toHaveBeenCalled();
  });

  it('supersedes the CURRENT outcome, scoped to this workspace', async () => {
    prisma.outcomeSnapshot.findFirst.mockResolvedValue({ id: 'out-old' });
    await record();
    expect(prisma.outcomeSnapshot.findFirst).toHaveBeenCalledWith({
      where: { decisionId: 'dec-1', workspaceId: 'ws-1', supersededAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
  });

  it('writes both halves in ONE transaction', async () => {
    // "A new current outcome exists" and "the old one is retired" are one fact. A
    // half-applied write leaves two rows claiming to be current — which accuracy
    // would paper over with its ordering and patterns would read as two
    // observations of the same decision.
    prisma.outcomeSnapshot.findFirst.mockResolvedValue({ id: 'out-old' });
    await record();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('R6 — accuracy scores the CURRENT outcome only', () => {
  it('filters superseded rows out of the nested read', async () => {
    prisma.decision.findMany.mockResolvedValue([]);
    await getAccuracy('ws-1');
    const { outcomes } = prisma.decision.findMany.mock.calls[0][0].select;
    expect(outcomes.where).toEqual({ supersededAt: null });
    expect(outcomes.orderBy).toEqual({ createdAt: 'desc' });
    expect(outcomes.take).toBe(1);
  });

  it('still scopes to this workspace', async () => {
    prisma.decision.findMany.mockResolvedValue([]);
    await getAccuracy('ws-1');
    expect(prisma.decision.findMany.mock.calls[0][0].where.workspaceId).toBe('ws-1');
  });

  it('scores a legacy outcome exactly as before — R6 does not retroactively invalidate it', async () => {
    // A row recorded before R6 has no provenance and no measuredAt. The scoring
    // path neither projects nor requires either, so the outcome is scored on
    // what it does carry. The alternative — excluding provenance-less rows —
    // would delete history to tidy a contract, and the honest reading of an
    // unrecorded fact is that it was not recorded, not that the row is void.
    prisma.decision.findMany.mockResolvedValue([{
      id: 'dec-legacy', verdict: 'KILL', confidence: 0.9, status: 'PROPOSED',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      humanExecutedAt: new Date('2026-01-02T00:00:00Z'), dismissedAt: null,
      outcomes: [{ spendDeltaMinor: -1000, revenueDeltaMinor: -200, roasDelta: 0.1, windowEnd: new Date('2026-01-09T00:00:00Z'), sustained: true }],
    }]);
    const result = await getAccuracy('ws-1', { now: new Date('2026-03-01T00:00:00Z') });
    expect(result.coverage.scored).toBe(1);

    const { outcomes } = prisma.decision.findMany.mock.calls[0][0].select;
    expect(outcomes.select.evidenceReference).toBeUndefined();
    expect(outcomes.select.measuredAt).toBeUndefined();
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
          // B4-A — acted on by EITHER route owes an outcome.
          OR: [{ humanExecutedAt: { not: null } }, { platformExecutedAt: { not: null } }],
          dismissedAt: null,
          // NONE of the CURRENT ones — a decision whose outcomes have all been
          // retired owes a fresh recording.
          outcomes: { none: { supersededAt: null } },
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
  it('orders by oldest DEBT first, across both provenance routes', async () => {
    // B4-A — the queue key is the EARLIEST of the two provenance columns, and no
    // Prisma orderBy expresses LEAST(a, b), so the ordering is applied in JS.
    // This asserts the BEHAVIOUR rather than the query shape: sorting on one
    // column and then the other would group every self-reported decision ahead
    // of every Lumi-executed one regardless of age, which is the bug this
    // ordering exists to avoid.
    const iso = (d) => new Date(d).toISOString();
    prisma.decision.findMany.mockResolvedValue([
      { id: 'newest-human',   humanExecutedAt: iso('2026-06-03'), platformExecutedAt: null },
      { id: 'oldest-platform', humanExecutedAt: null, platformExecutedAt: iso('2026-06-01') },
      { id: 'middle-human',   humanExecutedAt: iso('2026-06-02'), platformExecutedAt: null },
    ]);
    prisma.workspace.findUnique.mockResolvedValue({ currency: 'USD' });

    const out = await listPendingOutcomes('ws-1');
    expect(out.decisions.map((d) => d.id)).toEqual(['oldest-platform', 'middle-human', 'newest-human']);
  });

  it('defaults currency to USD when the workspace row is missing', async () => {
    prisma.decision.findMany.mockResolvedValue([]);
    prisma.workspace.findUnique.mockResolvedValue(null);
    const out = await listPendingOutcomes('ws-1');
    expect(out.currency).toBe('USD');
  });
});

// ============================================================
// R10 · Phase A — execution attribution
// ------------------------------------------------------------
// The controls here exist because the failure they guard is SILENT. Before R10
// a real Meta mutation simply did not appear in the Proof Engine's population,
// and nothing anywhere said so: the accuracy surface reported honestly on the
// decisions it could see, and the ones it could not see were the ones that had
// actually happened.
//
// So every test below is written to fail on a specific mutation of the source,
// named in its own comment. A test that would still pass with the attribution
// removed is not a control.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const decision = { findFirst: vi.fn(), updateMany: vi.fn() };
vi.mock('../../lib/prisma.js', () => ({ prisma: { decision } }));
vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { resolveAttribution, stampDecisionExecuted } = await import('./decisionAttribution.js');

const WS = '11111111-1111-1111-1111-111111111111';
const OTHER_WS = '22222222-2222-2222-2222-222222222222';
const DEC = '33333333-3333-3333-3333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
  decision.updateMany.mockResolvedValue({ count: 1 });
});

describe('R10 · resolveAttribution — fails closed', () => {
  it('resolves an id that belongs to this workspace', async () => {
    decision.findFirst.mockResolvedValue({ id: DEC });
    await expect(resolveAttribution(WS, DEC)).resolves.toEqual({ decisionId: DEC, rejected: false });
  });

  // THE CONTROL: drop `workspaceId` from the findFirst WHERE and this passes
  // while an operator in one account attributes an execution to another
  // account's decision. The assertion is on the QUERY, because a mock that
  // returns a row cannot tell us what was asked.
  it('scopes the lookup in the WHERE, not after it (R9 · I40)', async () => {
    decision.findFirst.mockResolvedValue({ id: DEC });
    await resolveAttribution(WS, DEC);
    expect(decision.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: DEC, workspaceId: WS } }),
    );
  });

  // A cross-workspace id must not resolve. `rejected: true` is what makes the
  // route refuse rather than execute the mutation unattributed.
  it('rejects an id from another workspace', async () => {
    decision.findFirst.mockResolvedValue(null); // scoped query finds nothing
    await expect(resolveAttribution(OTHER_WS, DEC)).resolves.toEqual({ decisionId: null, rejected: true });
  });

  it('rejects a non-existent id', async () => {
    decision.findFirst.mockResolvedValue(null);
    const out = await resolveAttribution(WS, 'not-a-decision');
    expect(out.rejected).toBe(true);
  });

  it('rejects a non-string id rather than passing it to the query', async () => {
    const out = await resolveAttribution(WS, { id: DEC });
    expect(out).toEqual({ decisionId: null, rejected: true });
    expect(decision.findFirst).not.toHaveBeenCalled();
  });

  // NOT a rejection. An execution with no originating decision is normal — an
  // operator acting on a campaign no sweep has written a verdict for. Turning
  // this into a refusal would break a real path.
  it.each([[undefined], [null], ['']])('treats absent input (%p) as unattributed, not rejected', async (v) => {
    await expect(resolveAttribution(WS, v)).resolves.toEqual({ decisionId: null, rejected: false });
    expect(decision.findFirst).not.toHaveBeenCalled();
  });

  // A read failure is "we could not establish attribution", never "there is
  // none". Returning { rejected: false } here would let a DB blip produce a real
  // mutation recorded as having no originating decision.
  it('treats a failed lookup as rejected, never as unattributed', async () => {
    decision.findFirst.mockRejectedValue(new Error('db down'));
    await expect(resolveAttribution(WS, DEC)).resolves.toEqual({ decisionId: null, rejected: true });
  });

  it('requires a workspaceId', async () => {
    await expect(resolveAttribution(null, DEC)).rejects.toThrow(/workspaceId required/);
  });
});

describe('R10 · stampDecisionExecuted — the lifecycle rule lives in the WHERE', () => {
  // NC30 (the positive half): a successful platform mutation stamps the call.
  it('stamps platformExecutedAt for an attributed decision', async () => {
    const at = new Date('2026-08-17T10:00:00Z');
    const out = await stampDecisionExecuted({ workspaceId: WS, decisionId: DEC, at });
    expect(out).toEqual({ stamped: true, reason: 'STAMPED' });
    expect(decision.updateMany).toHaveBeenCalledWith({
      where: { id: DEC, workspaceId: WS, platformExecutedAt: null, dismissedAt: null },
      data: { platformExecutedAt: at },
    });
  });

  // NC25: an execution carrying no decision cannot stamp anything. If this ever
  // fell through to updateMany it would write with `id: null` and match nothing
  // — but silently, and the reason code is what makes the gap countable.
  it('does nothing when the execution is unattributed (NC25)', async () => {
    const out = await stampDecisionExecuted({ workspaceId: WS, decisionId: null });
    expect(out).toEqual({ stamped: false, reason: 'NOT_ATTRIBUTED' });
    expect(decision.updateMany).not.toHaveBeenCalled();
  });

  // FIRST SUCCESS WINS. Remove `platformExecutedAt: null` from the predicate and a
  // second execution re-dates the column — turning "when they first acted" into
  // "when they last acted", which is the question nobody asked and which moves
  // every outcome measurement window with it.
  it('never re-dates an already-executed decision', async () => {
    decision.updateMany.mockResolvedValue({ count: 0 });
    const out = await stampDecisionExecuted({ workspaceId: WS, decisionId: DEC });
    expect(out).toEqual({ stamped: false, reason: 'ALREADY_RESOLVED' });
    expect(decision.updateMany.mock.calls[0][0].where).toHaveProperty('platformExecutedAt', null);
  });

  // Remove `dismissedAt: null` and an execution that named a rejected decision
  // would flip it to executed — leaving a row that reports itself as both
  // acted-on and refused, which routes/lumi/decisions.js refuses to create.
  it('cannot overturn an explicit dismissal', async () => {
    expect.assertions(2);
    decision.updateMany.mockResolvedValue({ count: 0 });
    const out = await stampDecisionExecuted({ workspaceId: WS, decisionId: DEC });
    expect(out.stamped).toBe(false);
    expect(decision.updateMany.mock.calls[0][0].where).toHaveProperty('dismissedAt', null);
  });

  // Idempotent under BullMQ redelivery: the same job twice changes nothing.
  it('is idempotent across repeated delivery of the same success', async () => {
    decision.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const first = await stampDecisionExecuted({ workspaceId: WS, decisionId: DEC });
    const second = await stampDecisionExecuted({ workspaceId: WS, decisionId: DEC });
    expect(first.stamped).toBe(true);
    expect(second.stamped).toBe(false);
  });

  // Never throws: the ad platform has already changed, and a thrown error here
  // would make BullMQ re-run a real budget mutation to fix a bookkeeping miss.
  it('never throws on a DB failure — it reports and returns', async () => {
    decision.updateMany.mockRejectedValue(new Error('db down'));
    await expect(stampDecisionExecuted({ workspaceId: WS, decisionId: DEC }))
      .resolves.toEqual({ stamped: false, reason: 'ERROR' });
  });

  it('requires a workspace to stamp', async () => {
    const out = await stampDecisionExecuted({ workspaceId: null, decisionId: DEC });
    expect(out.stamped).toBe(false);
  });
});

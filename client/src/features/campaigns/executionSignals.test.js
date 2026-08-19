// ============================================================
// executionSignals — the request that changes an ad account
// ------------------------------------------------------------
// Two claims, and the second matters more than the first:
//
//   1. Execute reaches the PRODUCER, with the canonical decisionId.
//   2. Execute NEVER reaches the self-report route.
//
// Those two endpoints record opposite things — one asks Lumi to act, the other
// records that a human already did — and the whole point of B3 is that a click
// on one can never be quietly served by the other. A test that only asserted
// "a POST happened" would pass against a wire-up that still stamped a timestamp.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const post = vi.hoisted(() => vi.fn(() => Promise.resolve({ data: { executionId: 'e1', status: 'QUEUED' } })));
const get = vi.hoisted(() => vi.fn(() => Promise.resolve({ data: { executions: [] } })));
const patch = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', () => ({ api: { post, get, patch } }));

const { executeWithLumi, fetchDecisionExecutions, newIdempotencyKey } = await import('./executionSignals.js');

const DEC = 'dec_0f4c';
const EXEC = Object.freeze({ actionType: 'PAUSE_CAMPAIGN', targetId: '23851234567', targetType: 'campaign' });

beforeEach(() => { post.mockClear(); get.mockClear(); patch.mockClear(); });

describe('the execute request', () => {
  it('posts to the canonical producer', async () => {
    await executeWithLumi({ decisionId: DEC, ...EXEC });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe('/api/execute/meta');
  });

  it('carries the exact decisionId, untouched', async () => {
    await executeWithLumi({ decisionId: DEC, ...EXEC });
    expect(post.mock.calls[0][1].decisionId).toBe(DEC);
  });

  it('sends the server\'s own action descriptor and nothing derived', async () => {
    await executeWithLumi({ decisionId: DEC, ...EXEC });
    const body = post.mock.calls[0][1];
    expect(body.actionType).toBe('PAUSE_CAMPAIGN');
    expect(body.targetId).toBe('23851234567');
    expect(body.targetType).toBe('campaign');
    // Exactly these five keys — no campaign name, no entityId, no row index.
    // Identity is the decisionId; anything else here is a second way to say
    // what is being acted on, and a second way is how they drift apart.
    expect(Object.keys(body).sort()).toEqual(
      ['actionType', 'decisionId', 'idempotencyKey', 'targetId', 'targetType'],
    );
  });

  it('never sends a name or an entity id', async () => {
    await executeWithLumi({ decisionId: DEC, ...EXEC });
    const wire = JSON.stringify(post.mock.calls[0][1]);
    expect(wire).not.toMatch(/name|entityId|campaignId/i);
  });

  it('NEVER touches the self-report route', async () => {
    // The claim this file exists for.
    await executeWithLumi({ decisionId: DEC, ...EXEC });
    expect(patch).not.toHaveBeenCalled();
    expect(post.mock.calls[0][0]).not.toMatch(/\/api\/lumi\/decisions/);
  });

  it('generates a fresh idempotency key per attempt', async () => {
    await executeWithLumi({ decisionId: DEC, ...EXEC });
    await executeWithLumi({ decisionId: DEC, ...EXEC });
    const [a, b] = post.mock.calls.map((c) => c[1].idempotencyKey);
    expect(a).toBeTruthy();
    // A key derived from the decision would make a deliberate second execution
    // — a retry after a real failure — silently return the first one's result.
    expect(a).not.toBe(b);
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe('it refuses to send an incomplete request', () => {
  it.each([
    ['no decisionId', { ...EXEC }],
    ['no actionType', { decisionId: DEC, targetId: '1', targetType: 'campaign' }],
    ['no targetId', { decisionId: DEC, actionType: 'PAUSE_CAMPAIGN', targetType: 'campaign' }],
    ['no targetType', { decisionId: DEC, actionType: 'PAUSE_CAMPAIGN', targetId: '1' }],
  ])('%s → rejects without a request', async (_label, args) => {
    await expect(executeWithLumi(args)).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });

  it('an empty call rejects rather than posting an empty body', async () => {
    await expect(executeWithLumi()).rejects.toThrow(/decisionId/);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('reading executions back', () => {
  it('asks the decision-scoped read path', async () => {
    await fetchDecisionExecutions(DEC);
    expect(get).toHaveBeenCalledWith(`/api/lumi/decisions/${DEC}/executions`);
  });

  it('encodes the id rather than interpolating it raw', async () => {
    await fetchDecisionExecutions('a/b?c');
    expect(get.mock.calls[0][0]).toBe('/api/lumi/decisions/a%2Fb%3Fc/executions');
  });

  it('refuses without an id', async () => {
    await expect(fetchDecisionExecutions()).rejects.toThrow(/decisionId/);
    expect(get).not.toHaveBeenCalled();
  });
});

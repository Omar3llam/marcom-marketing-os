// ============================================================
// R13-D / B2 — an outage must never render as an idle account
// ============================================================
// The DB contract suite proves what the endpoint says about real rows. This one
// proves what it says when there ARE no real rows to speak for — the two ways a
// response can be empty, which must never look alike:
//
//   the account has no canonical measurement  → available:false, a real answer
//   we could not read the database            → 500, not an answer at all
//
// Collapsing the second into the first is the failure I29 names: a caller that
// cannot tell "could not compute" from "nothing to act on" renders an outage as
// an all-clear. It needs a mocked service to reach, which is why it lives apart
// from the real-DB file.
// ============================================================
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getAccountAggregate } = vi.hoisted(() => ({ getAccountAggregate: vi.fn() }));
vi.mock('../../services/analysis/AccountAggregateService.js', () => ({ getAccountAggregate }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { accountRouter } = await import('./account.js');

const app = () => {
  const a = express();
  a.use((req, _res, next) => { req.workspaceId = 'ws-1'; req.collabRole = 'BUYER'; next(); });
  a.use('/api/lumi', accountRouter);
  return a;
};
const get = () => request(app()).get('/api/lumi/account/aggregate');

beforeEach(() => vi.clearAllMocks());

describe('the two kinds of empty', () => {
  it('a failed read is a 500 — never a successful-looking empty payload', async () => {
    getAccountAggregate.mockRejectedValue(new Error('canonical evidence read failed'));

    const res = await get();
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('AccountAggregateUnavailable');
    // The shapes a client branches on must be absent entirely, so no renderer
    // can read this as "measured, and there was nothing".
    expect(res.body).not.toHaveProperty('available');
    expect(res.body).not.toHaveProperty('aggregate');
  });

  it('an unmeasured account is a 200 that says so, with no numbers in it', async () => {
    getAccountAggregate.mockResolvedValue(null);

    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toBe('NO_CANONICAL_MEASUREMENT');
    expect(res.body.aggregate).toBeNull();
    // Not a zeroed shell. "0 spend across 0 campaigns" is a measurement, and
    // nothing measured this account.
    expect(JSON.stringify(res.body)).not.toMatch(/:0[,}]/);
  });

  it('the two are distinguishable from the response alone', async () => {
    getAccountAggregate.mockRejectedValue(new Error('db down'));
    const outage = await get();
    getAccountAggregate.mockResolvedValue(null);
    const empty = await get();

    expect(outage.status).not.toBe(empty.status);
  });

  it('does not leak the internal error text to the client', async () => {
    getAccountAggregate.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.4:5432'));
    const res = await get();
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|5432/);
  });
});

describe('the handler stays thin', () => {
  it('delegates to the service with the request\'s workspace and computes nothing itself', async () => {
    getAccountAggregate.mockResolvedValue({ spend: { minor: 1 } });
    await get();
    expect(getAccountAggregate).toHaveBeenCalledTimes(1);
    expect(getAccountAggregate).toHaveBeenCalledWith('ws-1');
  });
});

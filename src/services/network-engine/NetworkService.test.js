// ============================================================
// NetworkService — the cohort boundary (R11 · F12 / RU-5)
// ============================================================
// Two invariants, neither of which had a test before R11:
//
//   1. Cohort membership is SERVER-ASSIGNED. setConsent takes no cohort, and
//      the read re-derives it from the controlled attribute rather than
//      trusting the stored label.
//   2. The requesting workspace is EXCLUDED from its own aggregate. "Across N
//      consenting accounts" must mean N others, or the reader cannot tell an
//      independent signal from their own history echoed back.
//
// The engine itself is real here — K, minSupport and the Wilson bands are
// exercised end to end, because the point of the population change is what it
// does to the gate.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    workspace: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    accountPattern: { findMany: vi.fn() },
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../lib/prisma.js';
import { setConsent, getNetworkInsights, buildContributions } from './NetworkService.js';
import { aggregateNetwork } from './networkEngine.js';
import { NETWORK_STATUS } from './networkTypes.js';

const ME = 'ws-me';

/** One ESTABLISHED pattern row, as the read selects them. */
function pattern(workspaceId, accuracy = 0.8) {
  return {
    workspaceId, kind: 'FATIGUE_CEILING', metric: 'frequency',
    threshold: 3.5, accuracy, effectiveSupport: 4,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('setConsent — the cohort is assigned, not accepted', () => {
  it('derives the cohort from the workspace attribute and stores it', async () => {
    prisma.workspace.findUnique.mockResolvedValue({ currency: 'EGP' });
    prisma.workspace.update.mockResolvedValue({ id: ME, networkConsent: true, cohortTag: 'CUR-EGP' });

    await setConsent(ME, { optIn: true });

    const data = prisma.workspace.update.mock.calls[0][0].data;
    expect(data.cohortTag).toBe('CUR-EGP');
    expect(data.networkConsent).toBe(true);
    expect(data.consentedAt).toBeInstanceOf(Date);
  });

  it('ignores a cohortTag passed into the service — there is no parameter for it', async () => {
    prisma.workspace.findUnique.mockResolvedValue({ currency: 'USD' });
    prisma.workspace.update.mockResolvedValue({ id: ME });

    await setConsent(ME, { optIn: true, cohortTag: 'EG-apparel' });

    expect(prisma.workspace.update.mock.calls[0][0].data.cohortTag).toBe('CUR-USD');
  });

  it('opting out clears the cohort — no participation, no population', async () => {
    prisma.workspace.findUnique.mockResolvedValue({ currency: 'EGP' });
    prisma.workspace.update.mockResolvedValue({ id: ME });

    await setConsent(ME, { optIn: false });

    const data = prisma.workspace.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ networkConsent: false, cohortTag: null, consentedAt: null });
  });

  it('REFUSES to opt in when no cohort can be established — it does not consent anyway', async () => {
    // Writing networkConsent=true with cohortTag=null would record a consent
    // the network can never honour, and every subsequent read would answer
    // NOT_CONSENTED — telling an account that opted in that it had not.
    prisma.workspace.findUnique.mockResolvedValue({ currency: null });

    await expect(setConsent(ME, { optIn: true })).rejects.toMatchObject({ code: 'COHORT_UNAVAILABLE' });
    expect(prisma.workspace.update).not.toHaveBeenCalled();
  });
});

describe('getNetworkInsights — consent and cohort', () => {
  it('not consented → NOT_CONSENTED, and no peer query runs', async () => {
    prisma.workspace.findUnique.mockResolvedValue({ networkConsent: false, currency: 'EGP' });

    expect(await getNetworkInsights(ME)).toEqual({ status: NETWORK_STATUS.NOT_CONSENTED });
    expect(prisma.workspace.findMany).not.toHaveBeenCalled();
  });

  it('consented but uncohortable → UNAVAILABLE, not NOT_CONSENTED', async () => {
    // R10 (F4) kept these three states apart for a reason: only one of them is
    // the user's to act on. An infrastructure gap must not be reported as a
    // governance fact about the workspace.
    prisma.workspace.findUnique.mockResolvedValue({ networkConsent: true, currency: null });

    expect(await getNetworkInsights(ME)).toEqual({ status: NETWORK_STATUS.UNAVAILABLE });
    expect(prisma.workspace.findMany).not.toHaveBeenCalled();
  });

  it('re-derives the cohort from the attribute, not from the stored label', async () => {
    // A stale or hand-edited cohortTag must not decide anything. The row here
    // still carries a legacy self-declared tag; the answer is the derived one.
    prisma.workspace.findUnique.mockResolvedValue({ networkConsent: true, currency: 'EGP', cohortTag: 'EG-apparel' });
    prisma.workspace.findMany.mockResolvedValue([]);
    prisma.accountPattern.findMany.mockResolvedValue([]);

    const res = await getNetworkInsights(ME);

    expect(res.cohortTag).toBe('CUR-EGP');
    expect(prisma.workspace.findMany.mock.calls[0][0].where).not.toHaveProperty('cohortTag');
  });
});

describe('getNetworkInsights — self-exclusion (NC-F12b · the control)', () => {
  beforeEach(() => {
    prisma.workspace.findUnique.mockResolvedValue({ networkConsent: true, currency: 'EGP' });
  });

  it('excludes the requesting workspace from the peer query', async () => {
    prisma.workspace.findMany.mockResolvedValue([{ id: 'ws-a' }]);
    prisma.accountPattern.findMany.mockResolvedValue([]);

    await getNetworkInsights(ME);

    expect(prisma.workspace.findMany.mock.calls[0][0].where).toEqual({
      currency: 'EGP', networkConsent: true, id: { not: ME },
    });
  });

  it('only peer ids reach the pattern query — the reader\'s own id is not among them', async () => {
    const peers = ['ws-a', 'ws-b', 'ws-c', 'ws-d'];
    prisma.workspace.findMany.mockResolvedValue(peers.map((id) => ({ id })));
    prisma.accountPattern.findMany.mockResolvedValue([]);

    await getNetworkInsights(ME);

    const ids = prisma.accountPattern.findMany.mock.calls[0][0].where.workspaceId.in;
    expect(ids).toEqual(peers);
    expect(ids).not.toContain(ME);
  });

  it('a workspace alone in its cohort gets no insight from its own patterns', async () => {
    // The starkest form of the old bug: with self included, an account that
    // was the ONLY consenting member of its cohort still contributed, and
    // "across the network" could be built from exactly one account — itself.
    prisma.workspace.findMany.mockResolvedValue([]);
    prisma.accountPattern.findMany.mockResolvedValue([]);

    const res = await getNetworkInsights(ME);

    expect(res.status).toBe(NETWORK_STATUS.OK);
    expect(res.insights).toEqual([]);
    expect(prisma.accountPattern.findMany.mock.calls[0][0].where.workspaceId).toEqual({ in: [] });
  });
});

describe('K counts OTHER accounts (population semantics, pure layer)', () => {
  // Driven through buildContributions + the real engine rather than through
  // getNetworkInsights, because of the dormancy documented in the block below:
  // asserting K end-to-end would need a fixture that contradicts the service's
  // own SELECT, and a test that only passes against a fixture its production
  // caller cannot produce is not a control.
  const build = (ids) => buildContributions(
    ids.map((id) => ({ ...pattern(id), status: 'ESTABLISHED' })), 'CUR-EGP',
  );

  it('4 contributors are below the gate — suppressed, with no statement', () => {
    // The case self-inclusion used to convert into a pass: four peers plus the
    // reader made five distinct contributors, and up to a fifth of "across 5
    // consenting accounts" was the reader's own history returned as
    // corroboration. With the reader excluded, four is honestly four.
    const [insight] = aggregateNetwork({ contributions: build(['ws-a', 'ws-b', 'ws-c', 'ws-d']) });
    expect(insight).toMatchObject({
      status: NETWORK_STATUS.INSUFFICIENT_DATA, contributingWorkspaces: 4, needed: 5,
    });
    expect(insight.statement).toBeUndefined();
  });

  it('5 contributors clear it — K=5, Wilson band, no point estimate', () => {
    const [insight] = aggregateNetwork({ contributions: build(['ws-a', 'ws-b', 'ws-c', 'ws-d', 'ws-e']) });
    expect(insight.status).toBe(NETWORK_STATUS.OK);
    expect(insight.contributingWorkspaces).toBe(5);
    expect(insight.statement).toContain('5 consenting CUR-EGP accounts');
    expect(insight.accuracyBand).toHaveLength(2);
    expect(insight.accuracyBand[0]).toBeLessThan(insight.accuracyBand[1]);
  });

  it('carries no workspace identity into the aggregate', () => {
    const insight = aggregateNetwork({ contributions: build(['ws-a', 'ws-b', 'ws-c', 'ws-d', 'ws-e']) })[0];
    expect(JSON.stringify(insight)).not.toContain('ws-a');
  });
});

describe('KNOWN DORMANCY — the network layer emits nothing today', () => {
  // NOT introduced by R11, and deliberately NOT fixed by it. Recorded here so
  // the next reader finds it asserted rather than discovering it again.
  //
  // getNetworkInsights SELECTs { workspaceId, kind, metric, threshold,
  // accuracy, effectiveSupport } — no `status`. buildContributions then filters
  // on `p.status === 'ESTABLISHED'`. The field is undefined on every row, so
  // every row is dropped and the aggregate is always empty. It has behaved this
  // way since the Phase 5 commit that introduced it (f2240eb): the WHERE
  // already constrains status, and the JS filter is a defensive duplicate that
  // happens to be fatal.
  //
  // The one-word fix would begin flowing cross-account aggregates for the first
  // time. That is a product and governance decision about data sharing, not a
  // security repair, and R11 is not the place to make it — so this test pins
  // the current behaviour and will fail the moment someone turns it on, which
  // is exactly when a human should be looking.
  it('drops every row because the service never selects `status`', () => {
    const asSelected = { workspaceId: 'ws-a', kind: 'FATIGUE_CEILING', metric: 'frequency', threshold: 3.5, accuracy: 0.8, effectiveSupport: 4 };
    expect(asSelected.status).toBeUndefined();
    expect(buildContributions([asSelected], 'CUR-EGP')).toEqual([]);
  });

  it('and does so end to end — five real peers still yield zero insights', async () => {
    prisma.workspace.findUnique.mockResolvedValue({ networkConsent: true, currency: 'EGP' });
    const peers = ['ws-a', 'ws-b', 'ws-c', 'ws-d', 'ws-e'];
    prisma.workspace.findMany.mockResolvedValue(peers.map((id) => ({ id })));
    // Exactly the projection the service asks Prisma for.
    prisma.accountPattern.findMany.mockResolvedValue(peers.map((id) => pattern(id)));

    const res = await getNetworkInsights(ME);

    expect(res.status).toBe(NETWORK_STATUS.OK);
    expect(res.insights).toEqual([]);
  });
});

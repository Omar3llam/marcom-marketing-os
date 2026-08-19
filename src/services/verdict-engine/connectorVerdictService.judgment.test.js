// ============================================================
// R13-b — the human judgement reaches the surface that asks for it
// ============================================================
// The only backend change in this slice: four existing columns join an existing
// select and an existing projection. It has one job, and it is not cosmetic —
// without it the client cannot know on FIRST RENDER that a decision has already
// been judged. It would ask a question already answered, and only discover the
// answer by attempting to write it.
//
// So this file owns the same claim connectorVerdictService.evidence.test.js
// owns for R5 provenance: backend-has-it and API-exposes-it are different
// claims, and the surface reads the second one.
//
// It also pins what must NOT happen. A judgement is a THIRD axis: an OVERRIDE
// leaves `verdict` and `decisionVerdict` exactly as they were, because "Lumi
// said KILL" stays true when the buyer disagrees. Collapsing them into a
// corrected verdict would destroy the only evidence the disagreement happened.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCanonicalVerdictCampaigns, findMany, groupBy } = vi.hoisted(() => ({
  getCanonicalVerdictCampaigns: vi.fn(), findMany: vi.fn(), groupBy: vi.fn(),
}));
vi.mock('../entity-graph/index.js', () => ({ getCanonicalVerdictCampaigns }));
vi.mock('../../lib/prisma.js', () => ({ prisma: { decision: { findMany, groupBy } } }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getConnectorVerdicts } from './connectorVerdictService.js';

const WS = 'ws-1';
const C1 = 'c1';
const AT = new Date('2026-08-19T12:41:00.000Z');

const campaignRow = (over = {}) => ({
  entityId: C1, name: 'Eid', channel: 'META', objective: 'OUTCOME_SALES',
  spendMinor: 100_000, revenueMinor: 400_000, impressions: 50_000, clicks: 800,
  conversions: 20, frequency: 2.1, roas: 4, ctr: 0.016, currency: 'EGP',
  ...over,
});

const decisionRow = (over = {}) => ({
  id: 'd-1', entityId: C1, verdict: 'KILL',
  createdAt: new Date('2026-08-12T09:00:00Z'),
  evidenceReference: null,
  humanResponse: null, humanReasonCode: null, humanReasonNote: null, humanRespondedAt: null,
  ...over,
});

const verdictOf = async () => (await getConnectorVerdicts(WS)).verdicts[0];

beforeEach(() => {
  vi.clearAllMocks();
  getCanonicalVerdictCampaigns.mockResolvedValue({ campaigns: [campaignRow()], noCanonicalWindow: [] });
  groupBy.mockResolvedValue([]);
  findMany.mockResolvedValue([]);
});

describe('the identity read asks for the judgement columns', () => {
  it('names all four explicitly — never a select-less read', async () => {
    findMany.mockResolvedValue([decisionRow()]);
    await getConnectorVerdicts(WS);

    const { select } = findMany.mock.calls[0][0];
    expect(select).toMatchObject({
      humanResponse: true, humanReasonCode: true,
      humanReasonNote: true, humanRespondedAt: true,
    });
    // The R5/identity fields are still there — this widened the select, it did
    // not replace it.
    expect(select).toMatchObject({
      id: true, entityId: true, verdict: true, createdAt: true, evidenceReference: true,
    });
  });
});

describe('the payload carries what the human decided', () => {
  it('projects a recorded judgement onto the verdict row', async () => {
    findMany.mockResolvedValue([decisionRow({
      humanResponse: 'OVERRIDE', humanReasonCode: 'TOF_ROLE',
      humanReasonNote: 'prospecting budget', humanRespondedAt: AT,
    })]);

    const v = await verdictOf();
    expect(v.humanResponse).toBe('OVERRIDE');
    expect(v.humanReasonCode).toBe('TOF_ROLE');
    expect(v.humanReasonNote).toBe('prospecting budget');
    expect(v.humanRespondedAt).toEqual(AT);
  });

  it('projects all four as null when nobody has judged it', async () => {
    // NOT absent, and never coerced into CONFIRM or OTHER. The absence of an
    // opinion is not an opinion, and a client must be able to tell.
    findMany.mockResolvedValue([decisionRow()]);

    const v = await verdictOf();
    expect(v.decisionId).toBe('d-1');
    expect(v.humanResponse).toBeNull();
    expect(v.humanReasonCode).toBeNull();
    expect(v.humanReasonNote).toBeNull();
    expect(v.humanRespondedAt).toBeNull();
  });

  it('projects all four as null when no sweep has written a decision at all', async () => {
    findMany.mockResolvedValue([]);

    const v = await verdictOf();
    expect(v.decisionId).toBeNull();
    expect(v.humanResponse).toBeNull();
    expect(v.humanRespondedAt).toBeNull();
  });
});

describe('judgement is a third axis, not a correction', () => {
  it('leaves the live verdict and the stored verdict untouched by an OVERRIDE', async () => {
    findMany.mockResolvedValue([decisionRow({
      verdict: 'KILL', humanResponse: 'OVERRIDE',
      humanReasonCode: 'BRAND_ROLE', humanRespondedAt: AT,
    })]);

    const v = await verdictOf();
    // "Lumi said KILL" and "the buyer disagreed" are two facts. Neither edits
    // the other, and the payload states both.
    expect(v.decisionVerdict).toBe('KILL');
    expect(v.humanResponse).toBe('OVERRIDE');
    expect(v.verdict).toBeTruthy();
  });

  it('exposes no actor — R13 stores none, and one must not be invented', async () => {
    findMany.mockResolvedValue([decisionRow({ humanResponse: 'CONFIRM', humanRespondedAt: AT })]);

    const v = await verdictOf();
    for (const key of Object.keys(v)) {
      expect(key).not.toMatch(/^(humanUser|judgedBy|humanActor)/);
    }
  });
});

describe('the read stays an enhancement, not a dependency', () => {
  it('degrades to nulls rather than taking the verdict feed down', async () => {
    // The identity read has always had a .catch for exactly this: a campaign
    // still gets its verdict when the decision query fails, it just loses the
    // decision beside it.
    findMany.mockRejectedValue(new Error('column "humanResponse" does not exist'));

    const res = await getConnectorVerdicts(WS);
    expect(res.verdicts).toHaveLength(1);
    expect(res.verdicts[0].decisionId).toBeNull();
    expect(res.verdicts[0].humanResponse).toBeNull();
  });
});

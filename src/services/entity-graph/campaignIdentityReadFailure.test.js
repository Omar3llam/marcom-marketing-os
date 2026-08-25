// ============================================================
// B5 F-1 — a failed identity read is a system failure, not an empty workspace
// ============================================================
// The identity-layer twin of F-2, and the more dangerous of the two because its
// output was the most reassuring state the product has:
//
//   prisma.campaign.findMany(...).catch(() => [])
//        ↓  getCanonicalVerdictCampaigns short-circuits on !identities.length
//        ↓  evaluateConnectorVerdicts: gatedOut is empty, so status = NO_CAMPAIGNS
//        ↓  HTTP 200, and a fully-connected account is told to connect a channel
//
// A database failure is not evidence that a workspace has zero campaigns. The
// two are now different KINDS — a status string a caller computes, versus a
// thrown class — so collapsing them again means deleting a class rather than
// dropping a field.
//
// WHAT THIS SUITE DELIBERATELY ALSO GUARDS
// -----------------------------------------
// Test 7 exists because the cheap way to close F-1 is to make every empty
// population an error, and that is the opposite defect: a workspace that has
// genuinely synced nothing yet is not an outage. NO_CAMPAIGNS must survive.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    campaign:       { findMany: vi.fn() },
    metricSnapshot: { findMany: vi.fn() },
    decision:       { findMany: vi.fn() },
  },
}));
// Real engine, only observed — a replacement could not answer whether it runs.
vi.mock('../verdict-engine/verdictEngine.js', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, rollupVerdicts: vi.fn(mod.rollupVerdicts) };
});
vi.mock('../pattern-engine/institutionalMemory.js', async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, getInstitutionalMemory: vi.fn(async () => ({ status: 'NO_VALIDATED_MEMORY', records: [] })) };
});
vi.mock('../decision-memory/index.js', () => ({ getDecisionHistory: vi.fn(async () => []) }));

import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { rollupVerdicts } from '../verdict-engine/verdictEngine.js';
import {
  getCanonicalVerdictCampaigns,
  CampaignIdentityUnavailableError,
  CAMPAIGN_IDENTITY_READ_FAILED,
} from './EntityGraphService.js';
import { evaluateConnectorVerdicts, getConnectorVerdicts } from '../verdict-engine/connectorVerdictService.js';

const SOURCE = readFileSync(fileURLToPath(new URL('./EntityGraphService.js', import.meta.url)), 'utf8');
/** Comments stripped — the docblock QUOTES the old `.catch(() => [])` to explain
 *  it, and a ratchet that cannot tell prose from a call fires on its own
 *  documentation. §17 requires runtime integrity, not textual theater. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const WS = 'ws-a';
const identity = (id, name) => ({
  id, name, channel: 'META', objective: 'OUTCOME_SALES',
  externalId: `ext-${id}`, platformCreatedTime: new Date('2026-01-01T00:00:00Z'),
  _count: { adSets: 1 },
});
const canonicalRow = (entityId) => ({
  entityId, date: new Date('2026-08-24T09:00:00Z'), source: 'META', currency: 'USD',
  spendMinor: 500_000, revenueMinor: 1_500_000, impressions: 200_000, clicks: 4_000,
  conversions: 60, roas: 3, ctr: 0.02, frequency: 2.1, reach: 95_000,
  actionMetrics: null, dailyBudgetMinor: null, measurementWindow: 'CUMULATIVE_30D',
  windowStart: new Date('2026-07-26T00:00:00Z'), windowEnd: new Date('2026-08-24T00:00:00Z'),
});

beforeEach(() => {
  vi.clearAllMocks();
  prisma.decision.findMany.mockResolvedValue([]);
});

/**
 * Arrange a failing identity read — LAZILY.
 *
 * NOT `mockRejectedValue`: in vitest 4 that constructs the rejected promise at
 * arrange time, so a `beforeEach` using it leaves an unhandled rejection that
 * the runner attributes to whichever test runs next — including tests that
 * never touch Prisma at all. `mockImplementation` builds the promise only when
 * the mock is actually called, which is what these tests are asserting about.
 */
const failIdentityRead = (err = new Error('boom')) =>
  prisma.campaign.findMany.mockImplementation(() => Promise.reject(err));

// ── TEST 1 — the happy path is untouched ────────────────────────────────────
describe('1 · a successful populated identity read behaves exactly as before', () => {
  it('identities join to their canonical evidence', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity('c1', 'Alpha')]);
    prisma.metricSnapshot.findMany.mockResolvedValue([canonicalRow('c1')]);

    const { campaigns, noCanonicalWindow } = await getCanonicalVerdictCampaigns(WS);
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].entityId).toBe('c1');
    expect(noCanonicalWindow).toEqual([]);
  });

  it('the evaluation reaches OK and the engine runs', async () => {
    prisma.campaign.findMany.mockResolvedValue([identity('c1', 'Alpha')]);
    prisma.metricSnapshot.findMany.mockResolvedValue([canonicalRow('c1')]);

    const ev = await evaluateConnectorVerdicts(WS);
    expect(ev.status).toBe('OK');
    expect(rollupVerdicts).toHaveBeenCalledTimes(1);
  });

  it('the identity query itself is unchanged — scope, projection, ordering, cap', async () => {
    prisma.campaign.findMany.mockResolvedValue([]);
    await getCanonicalVerdictCampaigns(WS);

    const arg = prisma.campaign.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ workspaceId: WS });
    expect(arg.orderBy).toEqual({ createdAt: 'desc' });
    expect(arg.take).toBe(200);
    expect(arg.select.id).toBe(true);
    expect(arg.select._count).toEqual({ select: { adSets: true } });
  });
});

// ── TEST 2 + 7 — the state that must NOT become an error ────────────────────
describe('2 · a successful empty identity read is still NO_CAMPAIGNS', () => {
  beforeEach(() => prisma.campaign.findMany.mockResolvedValue([]));

  it('the reader resolves to an empty population rather than throwing', async () => {
    await expect(getCanonicalVerdictCampaigns(WS))
      .resolves.toEqual({ campaigns: [], noCanonicalWindow: [] });
  });

  it('the evaluation reports NO_CAMPAIGNS — a business answer, not a failure', async () => {
    const ev = await evaluateConnectorVerdicts(WS);
    expect(ev.status).toBe('NO_CAMPAIGNS');
    expect(ev.annotated).toBeNull();
    expect(ev.gatedOut).toEqual([]);
  });

  it('it never queries for canonical evidence it has no entities for', async () => {
    await getCanonicalVerdictCampaigns(WS);
    expect(prisma.metricSnapshot.findMany).not.toHaveBeenCalled();
  });

  it('no workspace resolves to an empty population without querying at all', async () => {
    await expect(getCanonicalVerdictCampaigns(null))
      .resolves.toEqual({ campaigns: [], noCanonicalWindow: [] });
    expect(prisma.campaign.findMany).not.toHaveBeenCalled();
  });
});

// ── TEST 3 — the central regression ─────────────────────────────────────────
describe('3 · a failed identity query is surfaced, never converted', () => {
  // Block body, NOT a concise arrow: `mockImplementation` returns the mock, and
  // a function returned from beforeEach is a TEARDOWN callback vitest will call
  // after every test — invoking the rejecting mock with nobody to catch it. The
  // whole describe then fails with the mock's own error and no assertion.
  beforeEach(() => { failIdentityRead(new Error('connection terminated')); });

  it('rejects with the stable code instead of resolving to an empty population', async () => {
    const err = await getCanonicalVerdictCampaigns(WS).catch((e) => e);
    expect(err).toBeInstanceOf(CampaignIdentityUnavailableError);
    expect(err.code).toBe(CAMPAIGN_IDENTITY_READ_FAILED);
    expect(err.campaigns).toBeUndefined();
  });

  it('never resolves — the failure cannot be read as a value', async () => {
    await expect(getCanonicalVerdictCampaigns(WS)).rejects.toThrow();
  });

  it('keeps the underlying error as `cause`, and names no database internals', async () => {
    const underlying = new Error('P1001: cannot reach database server at localhost:5432');
    failIdentityRead(underlying);

    const err = await getCanonicalVerdictCampaigns(WS).catch((e) => e);
    expect(err.cause).toBe(underlying);
    expect(err.message).not.toMatch(/P1001|localhost|5432/);
  });

  it('logs at error level with the workspace and the stable code', async () => {
    await getCanonicalVerdictCampaigns(WS).catch(() => {});
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toMatchObject({
      workspaceId: WS, code: CAMPAIGN_IDENTITY_READ_FAILED,
    });
  });
});

// ── TEST 4 + 13 — NO_CAMPAIGNS integrity ────────────────────────────────────
describe('4 · a failed read can never produce the "no campaigns" answer', () => {
  beforeEach(() => { failIdentityRead(new Error('read timed out')); });

  it('evaluateConnectorVerdicts rejects — it does NOT report NO_CAMPAIGNS', async () => {
    const out = await evaluateConnectorVerdicts(WS).then((v) => v, (e) => e);
    expect(out).toBeInstanceOf(Error);
    expect(out.code).toBe(CAMPAIGN_IDENTITY_READ_FAILED);
    expect(out.status).toBeUndefined();
  });

  it('the API-facing read rejects rather than returning an empty verdict feed', async () => {
    const out = await getConnectorVerdicts(WS).then((v) => v, (e) => e);
    expect(out).toBeInstanceOf(Error);
    expect(out.verdicts).toBeUndefined();
    expect(out.status).toBeUndefined();
  });

  it('nothing the failure carries can be mistaken for the empty-population status', async () => {
    const err = await evaluateConnectorVerdicts(WS).catch((e) => e);
    expect(JSON.stringify({ m: err.message, c: err.code, n: err.name })).not.toContain('NO_CAMPAIGNS');
  });

  it('NO_CAMPAIGNS is computed in exactly one place, and only from a read that returned', () => {
    // If a second producer ever appears, this fix stops being sufficient.
    const service = readFileSync(
      fileURLToPath(new URL('../verdict-engine/connectorVerdictService.js', import.meta.url)), 'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(service.match(/'NO_CAMPAIGNS'/g)).toHaveLength(1);
    expect(CODE).not.toContain('NO_CAMPAIGNS');
  });
});

// ── TEST 5 — the failure never enters verdict processing ────────────────────
describe('5 · no verdict processing runs on an unknown population', () => {
  beforeEach(() => { failIdentityRead(); });

  it('the verdict engine is never invoked', async () => {
    await evaluateConnectorVerdicts(WS).catch(() => {});
    expect(rollupVerdicts).not.toHaveBeenCalled();
  });

  it('canonical evidence is never read for a population we could not resolve', async () => {
    await getCanonicalVerdictCampaigns(WS).catch(() => {});
    expect(prisma.metricSnapshot.findMany).not.toHaveBeenCalled();
  });
});

// ── TEST 6 — workspace isolation ────────────────────────────────────────────
describe('6 · a failure in one workspace cannot leak into another', () => {
  it('a later workspace queries for itself and gets its own identities', async () => {
    failIdentityRead();
    await getCanonicalVerdictCampaigns('ws-a').catch(() => {});

    prisma.campaign.findMany.mockResolvedValueOnce([identity('b1', 'Bravo')]);
    prisma.metricSnapshot.findMany.mockResolvedValue([canonicalRow('b1')]);
    const { campaigns } = await getCanonicalVerdictCampaigns('ws-b');

    expect(campaigns.map((c) => c.entityId)).toEqual(['b1']);
    expect(prisma.campaign.findMany.mock.calls[1][0].where).toEqual({ workspaceId: 'ws-b' });
  });

  it('the failed workspace yields nothing at all — not the other workspace rows', async () => {
    prisma.campaign.findMany.mockResolvedValueOnce([identity('b1', 'Bravo')]);
    prisma.metricSnapshot.findMany.mockResolvedValue([canonicalRow('b1')]);
    await getCanonicalVerdictCampaigns('ws-b');

    failIdentityRead();
    const err = await getCanonicalVerdictCampaigns('ws-a').catch((e) => e);
    expect(err.code).toBe(CAMPAIGN_IDENTITY_READ_FAILED);
    expect(err.campaigns).toBeUndefined();
  });

  it('the reader holds no cache a stale population could be served from', () => {
    expect(CODE).not.toMatch(/^const\s+\w*[Cc]ache\w*\s*=/m);
    expect(CODE).not.toMatch(/^let\s+\w*(last|cached)\w*\s*=/mi);
  });
});

// ── TEST 7 — the over-correction guard ──────────────────────────────────────
describe('7 · a genuinely empty workspace is not an outage', () => {
  it('a real workspace with zero campaigns still reaches NO_CAMPAIGNS, twice over', async () => {
    // Run it twice: an over-correction that only fires on a second call, or that
    // caches the first answer, would pass a single-shot assertion.
    prisma.campaign.findMany.mockResolvedValue([]);
    for (const pass of [1, 2]) {
      const ev = await evaluateConnectorVerdicts(`ws-empty-${pass}`);
      expect(ev.status).toBe('NO_CAMPAIGNS');
    }
    expect(logger.error).not.toHaveBeenCalled();
  });
});

// ── §17 · the swallow cannot come back unnoticed ────────────────────────────
describe('the collapse cannot be reintroduced silently', () => {
  it('the identity read has no catch that returns an empty list', () => {
    const fn = CODE.slice(CODE.indexOf('async function verdictCampaignIdentities'));
    const body = fn.slice(0, fn.indexOf('\nexport async function getCanonicalVerdictCampaigns'));
    expect(body).not.toMatch(/return\s*\[\s*\]/);
    expect(body).not.toMatch(/\.catch\(/);
    expect(body).toMatch(/throw new CampaignIdentityUnavailableError/);
  });

  it('the two absences are different KINDS, not two values of one thing', () => {
    expect(new CampaignIdentityUnavailableError()).toBeInstanceOf(Error);
    expect(CAMPAIGN_IDENTITY_READ_FAILED).not.toBe('NO_CAMPAIGNS');
  });
});

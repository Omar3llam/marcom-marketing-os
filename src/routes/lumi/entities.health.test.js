// ============================================================
// GET /api/lumi/entities/health — role gate + composition contract
// ------------------------------------------------------------
// Gated to BUYER/STRATEGIST (a CLIENT is 403'd). Empty substrate → honest
// nulls. The engines are mocked — the scoring math is covered in
// AccountHealthService.test.js; this pins the WIRING.
//
// R13-C changed which population that wiring reads, and the change IS the point:
//
//   score / wastedSpend / needsRevenue  ← getCanonicalVerdictCampaigns (30 days)
//   revenueStale                        ← getConnectorCampaigns (operational)
//
// Health is a decision-layer signal: it weights verdicts by spend, and those
// verdicts are canonical 30-day. Pairing them with an operational aggregate (up
// to ~37 months, whatever the last sync asked for) made wastedSpend a number
// with no period. revenueStale stays operational because that read is the only
// place the actual-revenue overlay runs — the canonical path bypasses it by
// design, so a canonical-derived staleness would be false for everything.
// ============================================================
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getConnectorCampaigns } = vi.hoisted(() => ({ getConnectorCampaigns: vi.fn() }));
const { getCanonicalVerdictCampaigns } = vi.hoisted(() => ({ getCanonicalVerdictCampaigns: vi.fn() }));
const { getConnectorVerdicts } = vi.hoisted(() => ({ getConnectorVerdicts: vi.fn() }));

vi.mock('../../services/entity-graph/index.js', () => ({
  getConnectorCampaigns,
  getCanonicalVerdictCampaigns,
  getCampaignAdSets: vi.fn(),
  getAdSetAds: vi.fn(),
}));
// getConnectorVerdicts is mocked (the scoring math is covered elsewhere), but
// needsRevenueData is the REAL deterministic helper — the route's needsRevenue
// decoration must be exercised, not stubbed into always-false.
vi.mock('../../services/verdict-engine/index.js', async () => {
  const real = await vi.importActual('../../services/verdict-engine/connectorVerdictService.js');
  return { getConnectorVerdicts, needsRevenueData: real.needsRevenueData };
});
vi.mock('../../lib/prisma.js', () => ({
  prisma: { user: { findUnique: vi.fn().mockResolvedValue({ collabRole: null }) } },
}));
vi.mock('../../utils/logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { entitiesRouter } from './entities.js';

function makeApp({ collabRole } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 'firebase-user-1';
    req.workspaceId = 'ws1';
    if (collabRole !== undefined) req.collabRole = collabRole;
    next();
  });
  app.use('/', entitiesRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  // The canonical 30-day rows — what health is now measured over.
  getCanonicalVerdictCampaigns.mockResolvedValue({
    campaigns: [
      { entityId: 'a', name: 'A', spendMinor: 80000, ctr: 0.015, frequency: 1, roas: 2, currency: 'EGP' },
      { entityId: 'b', name: 'B', spendMinor: 20000, ctr: 0.015, frequency: 1, roas: 0.5, currency: 'EGP' },
    ],
    noCanonicalWindow: [],
  });
  // The operational rows — read ONLY for revenueStale. Deliberately given a
  // DIFFERENT spend, so a regression that scores these instead of the canonical
  // rows moves the numbers below rather than passing quietly.
  getConnectorCampaigns.mockResolvedValue([
    { entityId: 'a', name: 'A', spendMinor: 9_900_000, ctr: 0.015, frequency: 1, roas: 2 },
    { entityId: 'b', name: 'B', spendMinor: 100_000, ctr: 0.015, frequency: 1, roas: 0.5 },
  ]);
  getConnectorVerdicts.mockResolvedValue({
    verdicts: [
      { id: 'a', verdict: 'SCALE', roas: 2 },
      { id: 'b', verdict: 'KILL', roas: 0.5 },
    ],
    gatedOut: [], account: null, status: 'OK',
  });
});

describe('GET /entities/health', () => {
  it('403s a CLIENT (efficiency critique is an operator surface)', async () => {
    const res = await request(makeApp({ collabRole: 'CLIENT' })).get('/entities/health').expect(403);
    expect(res.body.error).toBe('RoleForbidden');
    expect(getCanonicalVerdictCampaigns).not.toHaveBeenCalled();
    expect(getConnectorCampaigns).not.toHaveBeenCalled();
  });

  it('lets a BUYER through and returns the composed analysis', async () => {
    const res = await request(makeApp({ collabRole: 'BUYER' })).get('/entities/health').expect(200);
    expect(res.body.score).toBe(70);                 // spend-weighted (85*.8 + 10*.2)
    expect(res.body.label).toBe('GOOD');
    expect(res.body.wastedSpend).toEqual({ minor: 20000, pct: 20, unavailable: null }); // KILL b
    expect(res.body).toMatchObject({ currency: 'EGP', currencyStatus: 'HOMOGENEOUS_KNOWN' });
    expect(res.body.campaigns).toHaveLength(2);
    expect(res.body.workspaceId).toBe('ws1');
  });

  // ── R13-C · the measurement contract ──────────────────────────────────
  it('scores from the CANONICAL rows, not the operational aggregate', async () => {
    // The two fixtures carry deliberately different spend. The operational rows
    // total 10,000,000 minor; the canonical rows total 100,000. A route that
    // regressed to getConnectorCampaigns would produce a wastedSpend of 100,000
    // (operational b) instead of 20,000 — the exact defect this slice closed,
    // where a 30-day KILL was multiplied by a lifetime spend.
    const res = await request(makeApp({ collabRole: 'STRATEGIST' })).get('/entities/health').expect(200);
    expect(res.body.wastedSpend.minor).toBe(20000);
    expect(res.body.wastedSpend.minor).not.toBe(100000);
  });

  it('STATES the window it measured, so no surface has to assume one', async () => {
    // Overview rendered 'last 30 days' and '/mo' as hardcoded strings over
    // numbers that had neither. The period is a fact about the payload and now
    // travels with it.
    const res = await request(makeApp({ collabRole: 'STRATEGIST' })).get('/entities/health').expect(200);
    expect(res.body.measurementWindow).toBe('CUMULATIVE_30D');
    expect(res.body.windowDays).toBe(30);
  });

  it('reads BOTH populations — the operational one only for revenueStale', async () => {
    await request(makeApp({ collabRole: 'STRATEGIST' })).get('/entities/health').expect(200);
    expect(getCanonicalVerdictCampaigns).toHaveBeenCalledWith('ws1');
    expect(getConnectorCampaigns).toHaveBeenCalledWith('ws1');
  });

  it('lets a STRATEGIST through', async () => {
    await request(makeApp({ collabRole: 'STRATEGIST' })).get('/entities/health').expect(200);
  });

  it('null collabRole is REFUSED — R11 (I61) removed the fail-open default', async () => {
    await request(makeApp({ collabRole: null })).get('/entities/health').expect(403);
  });

  it('keys verdicts onto campaigns by id (verdict.id → campaign.entityId)', async () => {
    const res = await request(makeApp({ collabRole: 'STRATEGIST' })).get('/entities/health').expect(200);
    const byId = Object.fromEntries(res.body.campaigns.map((c) => [c.entityId, c.verdict]));
    expect(byId).toEqual({ a: 'SCALE', b: 'KILL' });
  });

  // The Overview alert list renders c.name straight off this payload — without it
  // every alert reads "Unnamed campaign".
  it('carries the campaign name onto the health rows', async () => {
    const res = await request(makeApp({ collabRole: 'STRATEGIST' })).get('/entities/health').expect(200);
    expect(Object.fromEntries(res.body.campaigns.map((c) => [c.entityId, c.name])))
      .toEqual({ a: 'A', b: 'B' });
  });

  // The Overview "Revenue data needed" list reads these rows, so the flag has to
  // survive the health composition — and only for a real tracking gap.
  it('decorates needsRevenue: a spending CONVERSION campaign with no measured revenue', async () => {
    getCanonicalVerdictCampaigns.mockResolvedValue({
      campaigns: [
        { entityId: 'a', name: 'Sales No Rev', objective: 'OUTCOME_SALES', spendMinor: 80000, revenueMinor: 0, ctr: 0.015, frequency: 1, roas: null },
        { entityId: 'b', name: 'Brand Reach', objective: 'OUTCOME_AWARENESS', spendMinor: 20000, revenueMinor: 0, ctr: 0.015, frequency: 1, roas: null },
      ],
      noCanonicalWindow: [],
    });
    const res = await request(makeApp({ collabRole: 'STRATEGIST' })).get('/entities/health').expect(200);
    const byId = Object.fromEntries(res.body.campaigns.map((c) => [c.entityId, c.needsRevenue]));
    expect(byId.a).toBe(true);  // conversion + no revenue → a closable tracking gap
    expect(byId.b).toBe(false); // awareness → no revenue is EXPECTED, never flagged
  });

  // The Overview "Revenue data outdated" list reads these rows. The engine already
  // decided staleness — the route only carries the flag, so the two surfaces can
  // never disagree about whose revenue went stale.
  it('carries revenueStale onto the health rows, distinct from needsRevenue', async () => {
    getCanonicalVerdictCampaigns.mockResolvedValue({
      campaigns: [
        { entityId: 'a', name: 'Went Stale', spendMinor: 80000, ctr: 0.015, frequency: 1, roas: 2 },
        { entityId: 'b', name: 'Fresh', spendMinor: 20000, ctr: 0.015, frequency: 1, roas: 0.5 },
      ],
      noCanonicalWindow: [],
    });
    // The flag lives on the OPERATIONAL row and must still reach the payload.
    // The canonical rows above carry no revenueStale at all — which is exactly
    // why the route keeps reading both populations.
    getConnectorCampaigns.mockResolvedValue([
      { entityId: 'a', name: 'Went Stale', spendMinor: 80000, ctr: 0.015, frequency: 1, roas: 2, revenueStale: true },
      { entityId: 'b', name: 'Fresh', spendMinor: 20000, ctr: 0.015, frequency: 1, roas: 0.5 },
    ]);
    const res = await request(makeApp({ collabRole: 'STRATEGIST' })).get('/entities/health').expect(200);
    const byId = Object.fromEntries(res.body.campaigns.map((c) => [c.entityId, c]));
    expect(byId.a.revenueStale).toBe(true);
    expect(byId.b.revenueStale).toBe(false); // absent flag → false, never undefined
    expect(byId.a.needsRevenue).toBe(false); // stale ≠ never uploaded
  });

  it('no connector data → honest nulls, never a fabricated 0', async () => {
    getCanonicalVerdictCampaigns.mockResolvedValue({ campaigns: [], noCanonicalWindow: [] });
    getConnectorCampaigns.mockResolvedValue([]);
    getConnectorVerdicts.mockResolvedValue({ verdicts: [], gatedOut: [], account: null, status: 'NO_CAMPAIGNS' });
    const res = await request(makeApp({ collabRole: 'STRATEGIST' })).get('/entities/health').expect(200);
    expect(res.body.score).toBeNull();
    expect(res.body.label).toBeNull();
    expect(res.body.wastedSpend).toEqual({ minor: null, pct: null, unavailable: 'UNKNOWN_CURRENCY' });
    expect(res.body.currencyStatus).toBe('UNKNOWN');
    expect(res.body.campaigns).toEqual([]);
  });

  it('publishes an explicit mixed-currency refusal while preserving campaign verdicts', async () => {
    getCanonicalVerdictCampaigns.mockResolvedValue({
      campaigns: [
        { entityId: 'a', name: 'A', spendMinor: 80000, ctr: 0.015, frequency: 1, currency: 'EGP' },
        { entityId: 'b', name: 'B', spendMinor: 20000, ctr: 0.015, frequency: 1, currency: 'USD' },
      ],
      noCanonicalWindow: [],
    });
    const res = await request(makeApp({ collabRole: 'STRATEGIST' })).get('/entities/health').expect(200);
    expect(res.body).toMatchObject({
      currency: null,
      currencyStatus: 'MIXED',
      currencyUnavailable: 'MIXED_CURRENCY',
      score: null,
      wastedSpend: { minor: null, pct: null, unavailable: 'MIXED_CURRENCY' },
    });
    expect(res.body.campaigns.map((c) => c.verdict)).toEqual(['SCALE', 'KILL']);
    expect(res.body.campaigns.map((c) => c.impactScore)).toEqual([null, null]);
  });

  it('500s (never crashes) when an engine throws', async () => {
    getCanonicalVerdictCampaigns.mockRejectedValue(new Error('db down'));
    const res = await request(makeApp({ collabRole: 'STRATEGIST' })).get('/entities/health').expect(500);
    expect(res.body.error).toBe('HealthUnavailable');
  });
});

// ============================================================
// R8 §9 — one HTTP request, one verdict computation
// ------------------------------------------------------------
// /entities/verdicts and /entities/health both run the verdict pipeline, and
// the Campaigns page mounts hooks against both — so ONE page load computes
// verdicts twice. That is two SEPARATE HTTP requests, which R8 §4B defines as
// two logical evaluations, and unifying them would mean caching a result across
// requests — the one mechanism §5 forbids.
//
// What R8 does require is that neither request computes twice INSIDE itself.
// /entities/health was already correct here; this pins it, because the route
// reads the connector graph AND the verdicts and the obvious "just add the
// verdict map" change is exactly the one that would quietly make it two.
// ============================================================
describe('R8 · /entities/health computes the verdict once per request', () => {
  it('runs the verdict pipeline exactly ONCE', async () => {
    await request(makeApp({ collabRole: 'STRATEGIST' })).get('/entities/health').expect(200);
    expect(getConnectorVerdicts).toHaveBeenCalledTimes(1);
    // …for THIS workspace, with no second scoping argument that could widen it.
    expect(getConnectorVerdicts).toHaveBeenCalledWith('ws1');
  });

  it('derives every health figure from that one verdict set — it re-judges nothing', async () => {
    const res = await request(makeApp({ collabRole: 'STRATEGIST' })).get('/entities/health').expect(200);
    // 'b' is the KILL the engine returned; the route must report that verdict,
    // not one it worked out from roas 0.5 on its own (I27).
    const b = res.body.campaigns.find((c) => c.entityId === 'b');
    expect(b.verdict).toBe('KILL');
    expect(getConnectorVerdicts).toHaveBeenCalledTimes(1);
  });
});

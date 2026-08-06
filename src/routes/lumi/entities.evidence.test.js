// ============================================================
// GET /api/lumi/entities/:adSetId/evidence — analyzeEvidence's first caller
// ------------------------------------------------------------
// The verdict engine is NOT mocked here. That is the point of the file: this is
// the first production path into analyzeEvidence, and a test that stubs the
// engine would prove only that the route can call a spy. Every assertion below
// runs the real ranking, the real severity ladder and the real benchmark bars
// against rows shaped exactly as getAdSetAds returns them.
//
// The contract being pinned is the REFUSAL as much as the answer. analyzeEvidence
// returns a bare null in three distinct situations and cannot say which; the
// route re-derives them so the client can name the missing input instead of
// showing one "no data" shrug for a stale parent, a thin child set, and a set of
// ads that simply all perform alike.
// ============================================================
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getAdSetAds } = vi.hoisted(() => ({ getAdSetAds: vi.fn() }));

vi.mock('../../services/entity-graph/index.js', () => ({
  getConnectorCampaigns: vi.fn(), getCampaignAdSets: vi.fn(), getAdSetAds,
}));
// prisma is reached only by the role middleware and the sibling reasoning route.
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn().mockResolvedValue({ collabRole: null }) },
    decision: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock('../../utils/logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { entitiesRouter, VALID_EVIDENCE_METRICS } from './entities.js';
import { MIN_IMPRESSIONS_FOR_RANKING, METRIC_THRESHOLDS } from '../../services/verdict-engine/evidenceProvider.js';

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

// CTR is a stored RATIO here (0.021 = 2.1%), exactly as MetricSnapshot holds it.
// toPct is the engine's single conversion point; a percent typed in at this
// level would be caught by the benchmark assertions below.
const adRow = (id, over = {}) => ({
  entityId: id, channel: 'META', name: `Ad ${id}`, status: 'ACTIVE',
  platformCreatedTime: '2026-05-01T00:00:00.000Z',
  spendMinor: 20_000, ctr: 0.020, roas: 2.0, frequency: 2.0,
  impressions: 50_000, clicks: 1000, actionMetrics: null, ...over,
});

const adSetRow = (over = {}) => ({
  entityId: 'as1', channel: 'META', name: 'Broad 25-44', status: 'ACTIVE',
  adCount: 3, spendMinor: 90_000, ctr: 0.020, roas: 2.0, frequency: 2.0,
  impressions: 400_000, ...over,
});

// A healthy parent with one clearly failing child — the shape that produces a
// real ranking. -60% CTR is past the ctr floor (-0.20) by a wide margin.
const WORKING = {
  entity:    adSetRow(),
  objective: 'OUTCOME_SALES',
  // Deliberately spread: equal-CTR siblings would make `top` a stable-sort
  // artifact, and a test asserting one of them would be pinning V8, not the rule.
  children:  [adRow('ad1', { ctr: 0.030 }), adRow('ad2'), adRow('bad', { ctr: 0.008, roas: 0.4, frequency: 5.5 })],
};

const get = (url, collabRole = 'BUYER') => request(makeApp({ collabRole })).get(url);

beforeEach(() => {
  vi.clearAllMocks();
  getAdSetAds.mockResolvedValue(WORKING);
});

describe('the metric whitelist', () => {
  // The whitelist is hand-maintained so that adding a threshold to the engine
  // does not silently widen this API. The risk it buys is the opposite drift: a
  // metric exposed here that the engine has NO threshold for would fall through
  // to DEFAULT_THRESHOLD and be ranked on a CTR-shaped floor, silently.
  it('exposes only metrics the engine has a real threshold for', () => {
    for (const m of VALID_EVIDENCE_METRICS) {
      expect(METRIC_THRESHOLDS).toHaveProperty(m);
    }
  });

  it('is frozen — a request handler must not be able to widen its own surface', () => {
    expect(Object.isFrozen(VALID_EVIDENCE_METRICS)).toBe(true);
  });
});

describe('metric selection', () => {
  it('defaults to ctr when no metric is given', async () => {
    const res = await get('/entities/as1/evidence').expect(200);
    expect(res.body.metric).toBe('ctr');
    expect(res.body.evidence.metric).toBe('ctr');
  });

  it('ranks by roas when asked', async () => {
    const res = await get('/entities/as1/evidence?metric=roas').expect(200);
    expect(res.body.evidence.metric).toBe('roas');
    expect(res.body.evidence.summary.bottom.entityId).toBe('bad');
  });

  it('ranks by frequency — the one metric where HIGHER is worse', async () => {
    const res = await get('/entities/as1/evidence?metric=frequency').expect(200);
    // Index 0 is always the WORST. For a ceiling metric that is the HIGHEST
    // value; a direction-blind ranking would name a fresh ad the worst offender.
    expect(res.body.evidence.summary.bottom.entityId).toBe('bad');
    expect(res.body.evidence.summary.bottom.frequency).toBe(5.5);
  });

  it('400s an unsupported metric instead of silently ranking it on a CTR-shaped floor', async () => {
    const res = await get('/entities/as1/evidence?metric=cpc').expect(400);
    expect(res.body.reasonKey).toBe('INVALID_METRIC');
    expect(res.body.allowed).toEqual(['ctr', 'roas', 'frequency']);
    expect(getAdSetAds).not.toHaveBeenCalled(); // rejected before any read
  });

  it('400s a repeated metric param — an array must not coerce to its first value', async () => {
    const res = await get('/entities/as1/evidence?metric=ctr&metric=roas').expect(400);
    expect(res.body.reasonKey).toBe('INVALID_METRIC');
  });

  it('does not flag insufficientData on a 400 — the request was wrong, not the account', async () => {
    const res = await get('/entities/as1/evidence?metric=cpc').expect(400);
    expect(res.body.insufficientData).toBeUndefined();
    expect(res.body.error).toBe('InvalidMetric');
  });
});

describe('a real ranking', () => {
  it('returns the engine output whole: ranked, summary and dataConfidence', async () => {
    const { body } = await get('/entities/as1/evidence').expect(200);
    expect(body.insufficientData).toBe(false);
    expect(body.reasonKey).toBeNull();
    expect(body.evidence.ranked).toHaveLength(3);
    expect(body.evidence.summary.top.entityId).toBe('ad1');
    expect(body.evidence.summary.bottom.entityId).toBe('bad');
    expect(body.evidence.summary.outliers.map((o) => o.entityId)).toEqual(['bad']);
    expect(body.evidence.dataConfidence).toBeGreaterThan(0);
  });

  it('names the dimension it ranked, on the envelope AND inside the evidence', async () => {
    const { body } = await get('/entities/as1/evidence').expect(200);
    expect(body.dimension).toBe('AD');
    expect(body.evidence.dimension).toBe('AD');
  });

  it('reads real creative age off the rows — createdTime is NOT declared at this level', async () => {
    // The ad rows carry platformCreatedTime, so the engine must use it. Declaring
    // null here (as the ADSET route does) would throw away a known age and score
    // every ad-level analysis at the unknown-window 0.7.
    getAdSetAds.mockResolvedValue({
      ...WORKING,
      children: [
        adRow('a', { ctr: 0.030, actionMetrics: { lpv: 500, atc: 100 } }),
        adRow('b', { ctr: 0.008, actionMetrics: { lpv: 500, atc: 100 } }),
      ],
    });
    const { body } = await get('/entities/as1/evidence').expect(200);
    // 2026-05-01 is months before now → mature: 1.0 temporal, 1.0 completeness.
    expect(body.evidence.dataConfidence).toBe(0.97);
  });

  it('carries the ad-set row and objective alongside the evidence', async () => {
    const { body } = await get('/entities/as1/evidence').expect(200);
    expect(body.entity.entityId).toBe('as1');
    expect(body.objective).toBe('OUTCOME_SALES');
    expect(body.generatedAt).toEqual(expect.any(String));
  });

  it('states CTR evidence in PERCENT against the objective bar, not the stored ratio', async () => {
    const { body } = await get('/entities/as1/evidence').expect(200);
    const ctr = body.evidence.evidence.find((e) => e.metric === 'CTR');
    // 0.008 stored → 0.8% stated, judged against OUTCOME_SALES' 0.8 weak floor.
    expect(ctr.value).toBeCloseTo(0.8, 6);
    expect(ctr.benchmark).toBe(0.8);
  });
});

describe('objective degradation', () => {
  it('a null objective falls to the DEFAULT bar rather than refusing to analyse', async () => {
    getAdSetAds.mockResolvedValue({ ...WORKING, objective: null });
    const { body } = await get('/entities/as1/evidence').expect(200);
    expect(body.objective).toBeNull();
    expect(body.evidence).not.toBeNull();
    // DEFAULT's weak CTR floor is 0.8 — the same number OUTCOME_SALES carries,
    // which is why the assertion that MATTERS is that a bar was applied at all.
    expect(body.evidence.evidence.find((e) => e.metric === 'CTR').benchmark).toBe(0.8);
  });

  it('an awareness objective moves the bar — the objective is genuinely read', async () => {
    getAdSetAds.mockResolvedValue({ ...WORKING, objective: 'OUTCOME_AWARENESS' });
    const { body } = await get('/entities/as1/evidence').expect(200);
    expect(body.evidence.evidence.find((e) => e.metric === 'CTR').benchmark).toBe(0.5);
  });

  it('an unrecognised objective degrades to DEFAULT instead of throwing', async () => {
    getAdSetAds.mockResolvedValue({ ...WORKING, objective: 'SOMETHING_META_INVENTED' });
    const { body } = await get('/entities/as1/evidence').expect(200);
    expect(body.evidence).not.toBeNull();
  });
});

describe('the three refusals — each names the input that was missing', () => {
  it('BASELINE_UNAVAILABLE when the ad-set has no measured figure to rank against', async () => {
    getAdSetAds.mockResolvedValue({ ...WORKING, entity: adSetRow({ ctr: null }) });
    const { body } = await get('/entities/as1/evidence').expect(200);
    expect(body.reasonKey).toBe('BASELINE_UNAVAILABLE');
    expect(body.insufficientData).toBe(true);
    expect(body.evidence).toBeNull();
  });

  it('BASELINE_UNAVAILABLE reads the metric being ranked, not always ctr', async () => {
    // A perfectly good CTR baseline, but nothing to rank ROAS against. Hard-coding
    // the ctr check here would blame the ads for a missing parent revenue figure.
    getAdSetAds.mockResolvedValue({ ...WORKING, entity: adSetRow({ roas: 0 }) });
    const { body } = await get('/entities/as1/evidence?metric=roas').expect(200);
    expect(body.reasonKey).toBe('BASELINE_UNAVAILABLE');
  });

  it('INSUFFICIENT_REPORTING_ADS when fewer than two ads clear the delivery floor', async () => {
    getAdSetAds.mockResolvedValue({
      ...WORKING,
      children: [
        adRow('ad1'),
        adRow('fresh', { impressions: MIN_IMPRESSIONS_FOR_RANKING - 1 }),
        adRow('unreported', { ctr: null }),
      ],
    });
    const { body } = await get('/entities/as1/evidence').expect(200);
    expect(body.reasonKey).toBe('INSUFFICIENT_REPORTING_ADS');
    expect(body.evidence).toBeNull();
  });

  it('INSUFFICIENT_REPORTING_ADS on an ad-set with no ads at all', async () => {
    getAdSetAds.mockResolvedValue({ ...WORKING, children: [] });
    const { body } = await get('/entities/as1/evidence').expect(200);
    expect(body.reasonKey).toBe('INSUFFICIENT_REPORTING_ADS');
  });

  it('NO_MEANINGFUL_GAP when every ad performs alike — ordinary variance is not a finding', async () => {
    getAdSetAds.mockResolvedValue({
      ...WORKING,
      children: [adRow('a'), adRow('b', { ctr: 0.0198 }), adRow('c', { ctr: 0.0202 })],
    });
    const { body } = await get('/entities/as1/evidence').expect(200);
    expect(body.reasonKey).toBe('NO_MEANINGFUL_GAP');
    expect(body.evidence).toBeNull();
  });

  it('the three keys are distinct — a single "no data" would point at the wrong half', async () => {
    const seen = new Set();
    for (const [fixture] of [
      [{ ...WORKING, entity: adSetRow({ ctr: null }) }],
      [{ ...WORKING, children: [adRow('only')] }],
      [{ ...WORKING, children: [adRow('a'), adRow('b')] }],
    ]) {
      getAdSetAds.mockResolvedValue(fixture);
      const { body } = await get('/entities/as1/evidence').expect(200);
      seen.add(body.reasonKey);
    }
    expect(seen).toEqual(new Set(['BASELINE_UNAVAILABLE', 'INSUFFICIENT_REPORTING_ADS', 'NO_MEANINGFUL_GAP']));
  });

  it('never fabricates evidence on any refusal', async () => {
    for (const fixture of [
      { ...WORKING, entity: adSetRow({ ctr: null }) },
      { ...WORKING, children: [] },
      { ...WORKING, children: [adRow('a'), adRow('b')] },
    ]) {
      getAdSetAds.mockResolvedValue(fixture);
      const { body } = await get('/entities/as1/evidence').expect(200);
      expect(body.evidence).toBeNull();
      expect(body.insufficientData).toBe(true);
    }
  });
});

describe('404 and failure', () => {
  it('404s a foreign ad-set — never an empty evidence payload', async () => {
    getAdSetAds.mockResolvedValue(null);
    const res = await get('/entities/as1/evidence').expect(404);
    expect(res.body.error).toBe('AdSetNotFound');
  });

  it('500s without leaking the error message', async () => {
    getAdSetAds.mockRejectedValue(new Error('connection terminated'));
    const res = await get('/entities/as1/evidence').expect(500);
    expect(res.body).toEqual({ error: 'EvidenceUnavailable', message: 'Request failed' });
  });
});

describe('role gate — mirrors /ads', () => {
  it('403s a CLIENT: an ad-by-ad efficiency critique is exactly what a client never sees', async () => {
    const res = await get('/entities/as1/evidence', 'CLIENT').expect(403);
    expect(res.body.error).toBe('RoleForbidden');
    expect(getAdSetAds).not.toHaveBeenCalled();
  });

  it('lets a BUYER through', async () => {
    await get('/entities/as1/evidence', 'BUYER').expect(200);
  });

  it('lets a STRATEGIST through', async () => {
    await get('/entities/as1/evidence', 'STRATEGIST').expect(200);
  });

  it('null collabRole is treated as STRATEGIST (seed default)', async () => {
    await get('/entities/as1/evidence', null).expect(200);
  });
});

describe('route disambiguation', () => {
  it('/evidence does not capture /ads or /adsets', async () => {
    await get('/entities/as1/ads').expect(200);
    const { body } = await get('/entities/as1/ads').expect(200);
    expect(body).not.toHaveProperty('evidence'); // the ads route, not this one
  });
});

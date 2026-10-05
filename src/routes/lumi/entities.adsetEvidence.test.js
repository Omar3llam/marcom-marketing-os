// ============================================================
// GET /api/lumi/entities/:campaignId/adsets/evidence — the ADSET dimension
// ------------------------------------------------------------
// Same engine, one level up: ad-SETS ranked against their CAMPAIGN. The verdict
// engine is not mocked here, for the same reason as the ad-level file — a test
// that stubs the ranking proves only that the route can call a spy.
//
// Two things are specific to this level and are what this file is really for:
//
//   1. The PATH. '/:campaignId/evidence' and '/:adSetId/evidence' are the SAME
//      express pattern — the param name is a label, not a discriminator — so the
//      four-segment path is load-bearing, not cosmetic.
//   2. createdTime: null. An ad set is not a creative and has no platform
//      creation time to report. Declaring that stops the engine charging the
//      absence twice, which would silently depress every ad-set-level score on a
//      scale a consumer believes it shares with the ad-level one.
// ============================================================
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  getCampaignAdSets: vi.fn(), getAdSetAds: vi.fn(), getConnectorCampaigns: vi.fn(),
}));

vi.mock('../../services/entity-graph/index.js', () => ({
  getConnectorCampaigns: h.getConnectorCampaigns,
  getCampaignAdSets: h.getCampaignAdSets,
  getAdSetAds: h.getAdSetAds,
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn().mockResolvedValue({ collabRole: null }) },
    decision: { findMany: vi.fn().mockResolvedValue([]) },
  },
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

// toAdSetRow's real shape: metrics from the snapshot, and NO platformCreatedTime
// — that field is absent by design at this level, which is the whole premise.
// The full funnel bag keeps dataCompleteness at 1.0, so creative-age handling is
// the ONLY thing moving dataConfidence in the tests below.
const adSetRow = (id, over = {}) => ({
  entityId: id, source: 'META', measurementWindow: 'ROLLING_WINDOW',
  windowStart: '2026-08-01T00:00:00.000Z', windowEnd: '2026-08-30T00:00:00.000Z',
  currency: 'EGP', currencyProvenance: 'PLATFORM_REPORTED', evidenceRows: [{ entityId: id, source: 'META' }], channel: 'META', name: `AdSet ${id}`, status: 'ACTIVE', adCount: 4,
  spendMinor: 30_000, ctr: 0.020, roas: 2.0, frequency: 2.0,
  impressions: 60_000, clicks: 1200, actionMetrics: { lpv: 1200, atc: 240 }, ...over,
});

const campaignRow = (over = {}) => ({
  entityId: 'c1', source: 'META', measurementWindow: 'ROLLING_WINDOW',
  windowStart: '2026-08-01T00:00:00.000Z', windowEnd: '2026-08-30T00:00:00.000Z',
  currency: 'EGP', currencyProvenance: 'PLATFORM_REPORTED', evidenceRows: [{ entityId: 'c1', source: 'META' }], channel: 'META', name: 'Q3 Sales', objective: 'OUTCOME_SALES',
  externalId: '23851', platformCreatedTime: '2026-04-01T00:00:00.000Z', adSetCount: 3,
  spendMinor: 400_000, ctr: 0.020, roas: 2.0, frequency: 2.0, impressions: 900_000,
  ...over,
});

const WORKING = {
  entity:    campaignRow(),
  objective: 'OUTCOME_SALES',
  adSets: [
    adSetRow('as1', { ctr: 0.030 }),
    adSetRow('as2'),
    adSetRow('worst', { ctr: 0.008, roas: 0.4, frequency: 5.5 }),
  ],
};

const get = (url, collabRole = 'BUYER') => request(makeApp({ collabRole })).get(url);
const EVIDENCE_URL = '/entities/c1/adsets/evidence';

beforeEach(() => {
  vi.clearAllMocks();
  h.getCampaignAdSets.mockResolvedValue(WORKING);
  h.getAdSetAds.mockResolvedValue({ entity: adSetRow('as1'), objective: null, children: [] });
});

describe('a real ADSET-dimension ranking', () => {
  it('ranks the ad-sets against the campaign and names the dimension', async () => {
    const { body } = await get(EVIDENCE_URL).expect(200);
    expect(body.dimension).toBe('ADSET');
    expect(body.insufficientData).toBe(false);
    expect(body.reasonKey).toBeNull();
    expect(body.evidence.dimension).toBe('ADSET');
    expect(body.evidence.summary.bottom.entityId).toBe('worst');
    expect(body.evidence.summary.top.entityId).toBe('as1');
    expect(body.evidence.ranked).toHaveLength(3);
  });

  it('carries the campaign row and objective alongside', async () => {
    const { body } = await get(EVIDENCE_URL).expect(200);
    expect(body.entity.entityId).toBe('c1');
    expect(body.objective).toBe('OUTCOME_SALES');
    expect(body.metric).toBe('ctr');
    expect(body.generatedAt).toEqual(expect.any(String));
  });

  it('reads the campaign, not the ad-set service', async () => {
    await get(EVIDENCE_URL).expect(200);
    expect(h.getCampaignAdSets).toHaveBeenCalledWith('ws1', 'c1');
    expect(h.getAdSetAds).not.toHaveBeenCalled();
  });

  it('supports the same metrics as the ad dimension', async () => {
    for (const metric of ['ctr', 'roas', 'frequency']) {
      const { body } = await get(`${EVIDENCE_URL}?metric=${metric}`).expect(200);
      expect(body.evidence.metric).toBe(metric);
      expect(body.evidence.summary.bottom.entityId).toBe('worst');
    }
  });
});

// The reason this endpoint needed an engine change rather than just a route.
describe('createdTime: null — the absence is charged once, not twice', () => {
  it('scores an ad-set cohort at the honest unknown-window level, not below it', async () => {
    // 1.0 sample x 1.0 completeness x 0.7 temporal. Were the level ALSO charged
    // the missing-field 0.10, this would be 0.63 — 10% lower for a reason that
    // has nothing to do with the data.
    const { body } = await get(EVIDENCE_URL).expect(200);
    expect(body.evidence.dataConfidence).toBeCloseTo(0.7, 10);
  });

  it('outscores an AD cohort whose rows genuinely FAILED to report their age', async () => {
    // The distinction, demonstrated against the sibling route on matched data:
    // identical traffic, identical funnel, identical objective, both with an
    // unknown learning window. The AD rows SHOULD have carried a creative age and
    // did not — a real ingestion gap, charged twice (0.7 x 0.90 = 0.63). The ad
    // sets have none to carry, so the gap is charged once (0.7 x 1.00 = 0.70).
    h.getAdSetAds.mockResolvedValue({
      entity: adSetRow('as1'), objective: 'OUTCOME_SALES',
      children: [
        adSetRow('ad1', { ctr: 0.030, platformCreatedTime: null }),
        adSetRow('ad2', { ctr: 0.008, platformCreatedTime: null }),
      ],
    });
    const adLevel    = await get('/entities/as1/evidence').expect(200);
    const adSetLevel = await get(EVIDENCE_URL).expect(200);

    expect(adLevel.body.evidence.dataConfidence).toBeCloseTo(0.63, 10);
    expect(adSetLevel.body.evidence.dataConfidence).toBeCloseTo(0.70, 10);
    expect(adSetLevel.body.evidence.dataConfidence)
      .toBeGreaterThan(adLevel.body.evidence.dataConfidence);
  });

  it('is not sensitive to a stray platformCreatedTime on an ad-set row', async () => {
    // If a future row ever carries one, the declared null must still win — the
    // route asserts a fact about the LEVEL, not about the row it happened to get.
    h.getCampaignAdSets.mockResolvedValue({
      ...WORKING,
      adSets: WORKING.adSets.map((a) => ({ ...a, platformCreatedTime: '2026-04-01T00:00:00.000Z' })),
    });
    const { body } = await get(EVIDENCE_URL).expect(200);
    expect(body.evidence.dataConfidence).toBeCloseTo(0.7, 10);
  });
});

describe('the three refusals, at ADSET level', () => {
  it('BASELINE_UNAVAILABLE when the campaign has no measured figure', async () => {
    h.getCampaignAdSets.mockResolvedValue({ ...WORKING, entity: campaignRow({ ctr: null }) });
    const { body } = await get(EVIDENCE_URL).expect(200);
    expect(body.reasonKey).toBe('BASELINE_UNAVAILABLE');
    expect(body.evidence).toBeNull();
    expect(body.insufficientData).toBe(true);
  });

  it('BASELINE_UNAVAILABLE reads the metric being ranked', async () => {
    h.getCampaignAdSets.mockResolvedValue({ ...WORKING, entity: campaignRow({ roas: 0 }) });
    const { body } = await get(`${EVIDENCE_URL}?metric=roas`).expect(200);
    expect(body.reasonKey).toBe('BASELINE_UNAVAILABLE');
  });

  it('INSUFFICIENT_REPORTING_ADSETS — the cohort noun is per-level', async () => {
    h.getCampaignAdSets.mockResolvedValue({ ...WORKING, adSets: [adSetRow('only')] });
    const { body } = await get(EVIDENCE_URL).expect(200);
    // NOT the ad-level key: an operator told to add ads when the gap is ad-sets
    // would act on the wrong level.
    expect(body.reasonKey).toBe('INSUFFICIENT_REPORTING_ADSETS');
  });

  it('INSUFFICIENT_REPORTING_ADSETS on a campaign with no ad-sets at all', async () => {
    h.getCampaignAdSets.mockResolvedValue({ ...WORKING, adSets: [] });
    const { body } = await get(EVIDENCE_URL).expect(200);
    expect(body.reasonKey).toBe('INSUFFICIENT_REPORTING_ADSETS');
  });

  it('NO_MEANINGFUL_GAP when the ad-sets all perform alike', async () => {
    h.getCampaignAdSets.mockResolvedValue({
      ...WORKING,
      adSets: [adSetRow('a'), adSetRow('b', { ctr: 0.0198 }), adSetRow('c', { ctr: 0.0202 })],
    });
    const { body } = await get(EVIDENCE_URL).expect(200);
    expect(body.reasonKey).toBe('NO_MEANINGFUL_GAP');
  });

  it('never fabricates evidence on any refusal', async () => {
    for (const fixture of [
      { ...WORKING, entity: campaignRow({ ctr: null }) },
      { ...WORKING, adSets: [] },
      { ...WORKING, adSets: [adSetRow('a'), adSetRow('b')] },
    ]) {
      h.getCampaignAdSets.mockResolvedValue(fixture);
      const { body } = await get(EVIDENCE_URL).expect(200);
      expect(body.evidence).toBeNull();
      expect(body.insufficientData).toBe(true);
      // entity and objective are present in EVERY shape — a client rendering the
      // refusal still has a row to name.
      expect(body).toHaveProperty('objective');
      expect(body.entity).not.toBeNull();
    }
  });
});

describe('metric validation, 404 and failure', () => {
  it('400s an unsupported metric before reading anything', async () => {
    const res = await get(`${EVIDENCE_URL}?metric=cpc`).expect(400);
    expect(res.body.reasonKey).toBe('INVALID_METRIC');
    expect(res.body.allowed).toEqual(['ctr', 'roas', 'frequency']);
    expect(h.getCampaignAdSets).not.toHaveBeenCalled();
  });

  it('404s a foreign campaign with the code its sibling route already publishes', async () => {
    h.getCampaignAdSets.mockResolvedValue(null);
    const res = await get(EVIDENCE_URL).expect(404);
    expect(res.body.error).toBe('CampaignNotFound');
  });

  it('500s without leaking the error message', async () => {
    h.getCampaignAdSets.mockRejectedValue(new Error('connection terminated'));
    const res = await get(EVIDENCE_URL).expect(500);
    expect(res.body).toEqual({ error: 'EvidenceUnavailable', message: 'Request failed' });
  });
});

describe('role gate', () => {
  it('403s a CLIENT', async () => {
    const res = await get(EVIDENCE_URL, 'CLIENT').expect(403);
    expect(res.body.error).toBe('RoleForbidden');
    expect(h.getCampaignAdSets).not.toHaveBeenCalled();
  });

  it('lets a BUYER through', async () => { await get(EVIDENCE_URL, 'BUYER').expect(200); });
  it('lets a STRATEGIST through', async () => { await get(EVIDENCE_URL, 'STRATEGIST').expect(200); });
  it('null collabRole is REFUSED — R11 (I61) removed the fail-open default', async () => { await get(EVIDENCE_URL, null).expect(403); });
});

// The collision this path exists to avoid. '/:campaignId/evidence' would have
// been the same express pattern as '/:adSetId/evidence' — first registration
// wins for every request, and no param name would have separated them.
describe('route disambiguation — three live paths, three distinct handlers', () => {
  it('/:campaignId/adsets/evidence hits the ADSET dimension', async () => {
    const { body } = await get(EVIDENCE_URL).expect(200);
    expect(body.dimension).toBe('ADSET');
    expect(h.getCampaignAdSets).toHaveBeenCalled();
    expect(h.getAdSetAds).not.toHaveBeenCalled();
  });

  it('/:adSetId/evidence still hits the AD dimension', async () => {
    h.getAdSetAds.mockResolvedValue({
      entity: adSetRow('as1'), objective: 'OUTCOME_SALES',
      children: [
        { entityId: 'ad1', ctr: 0.03, impressions: 10_000, platformCreatedTime: null, actionMetrics: null, spendMinor: 1000, frequency: 2 },
        { entityId: 'ad2', ctr: 0.005, impressions: 10_000, platformCreatedTime: null, actionMetrics: null, spendMinor: 1000, frequency: 2 },
      ],
    });
    const { body } = await get('/entities/as1/evidence').expect(200);
    expect(body.dimension).toBe('AD');
    expect(h.getCampaignAdSets).not.toHaveBeenCalled();
  });

  it('/:campaignId/adsets still returns the plain ad-set list, not evidence', async () => {
    const { body } = await get('/entities/c1/adsets').expect(200);
    expect(body.adSets).toHaveLength(3);
    expect(body).not.toHaveProperty('evidence');
    // The baseline the evidence route needs is now carried here too — additive.
    expect(body.entity.entityId).toBe('c1');
    expect(body.objective).toBe('OUTCOME_SALES');
  });
});

describe('P7-07A published entity comparison envelope (adSets)', () => {
  it.each([{ source: 'GOOGLE' }, { source: null }, { source: 'UNKNOWN' },
    { windowStart: null }, { windowEnd: null }, { windowStart: '2026-02-30' },
    { measurementWindow: 'LEGACY_UNKNOWN' }, { measurementWindow: 'DAILY' },
    { windowStart: '2026-07-01', windowEnd: '2026-07-30' }])('refuses incompatible rankable rows %j', async (fields) => {
    h.getCampaignAdSets.mockResolvedValue({ ...WORKING, adSets: WORKING.adSets.map((r) => ({ ...r, ...fields })) });
    const { body } = await get('/entities/c1/adsets/evidence').expect(200);
    expect(body).toMatchObject({ evidence: null, comparisonEnvelope: null, insufficientData: true, reasonKey: 'COMPARISON_ENVELOPE_UNAVAILABLE' });
    expect(JSON.stringify(body)).not.toContain('_gap');
  });
  it.each([{ source: null }, { windowStart: null }, { windowEnd: 'bad date' }, { measurementWindow: 'LEGACY_UNKNOWN' }])(
    'refuses unproved parent envelope %j separately from its available metric', async (fields) => {
      h.getCampaignAdSets.mockResolvedValue({ ...WORKING, entity: { ...WORKING.entity, ...fields } });
      const { body } = await get('/entities/c1/adsets/evidence').expect(200);
      expect(body.reasonKey).toBe('COMPARISON_ENVELOPE_UNAVAILABLE');
      expect(body.evidence).toBeNull();
    });
  it('publishes the exact proven subset and exclusions, preserving each side', async () => {
    const rows = WORKING.adSets;
    h.getCampaignAdSets.mockResolvedValue({ ...WORKING, adSets: [rows[0], rows[2], { ...rows[1], ctr: 0, windowStart: '2026-07-01' }] });
    const { body } = await get('/entities/c1/adsets/evidence').expect(200);
    expect(body.comparisonEnvelope).toMatchObject({ status: 'AVAILABLE', kind: 'RELATIVE_BASELINE', metric: 'ctr', valueUnit: 'RATIO',
      gapUnit: 'RELATIVE_RATIO', gapDenominator: 'PARENT_VALUE', source: 'META', measurementWindow: 'ROLLING_WINDOW',
      windowStart: '2026-08-01T00:00:00.000Z', windowEnd: '2026-08-30T00:00:00.000Z',
      currency: null, currencyProvenance: null, rankableCount: 3, comparableCount: 2, excludedByEnvelopeCount: 1 });
    expect(body.evidence.comparisonEnvelope).toEqual(body.comparisonEnvelope);
    expect(body.evidence.ranked.map((r) => r.entityId)).toEqual([rows[2].entityId, rows[0].entityId]);
    expect(body.evidence.summary.bottom.entityId).toBe(rows[2].entityId);
    expect(body.evidence.summary.top.entityId).toBe(rows[0].entityId);
    expect(body.evidence.summary.outliers.map((r) => r.entityId)).toEqual([rows[2].entityId]);
    for (const row of [body.entity, ...body.evidence.ranked]) expect(row).toMatchObject({ source: 'META',
      measurementWindow: 'ROLLING_WINDOW', windowStart: '2026-08-01T00:00:00.000Z', windowEnd: '2026-08-30T00:00:00.000Z' });
  });
  it('does not call a rankable cohort with only one comparable row thin reporting', async () => {
    h.getCampaignAdSets.mockResolvedValue({ ...WORKING, adSets: WORKING.adSets.map((r, i) => i === 0 ? r : { ...r, windowStart: null }) });
    const { body } = await get('/entities/c1/adsets/evidence').expect(200);
    expect(body.reasonKey).toBe('COMPARISON_ENVELOPE_UNAVAILABLE');
    expect(body.evidence).toBeNull();
  });
  it.each([{ currency: 'USD' }, { currencyProvenance: 'WORKSPACE_INFERRED' },
    { evidenceRows: [{ source: 'META' }, { source: 'GA4' }] }])('rejects ROAS monetary basis %j without disabling platform ROAS', async (fields) => {
    const valid = await get('/entities/c1/adsets/evidence?metric=roas').expect(200);
    expect(valid.body.comparisonEnvelope).toMatchObject({ currency: 'EGP', currencyProvenance: 'PLATFORM_REPORTED', valueUnit: 'MULTIPLE' });
    h.getCampaignAdSets.mockResolvedValue({ ...WORKING, adSets: WORKING.adSets.map((r) => ({ ...r, ...fields })) });
    const { body } = await get('/entities/c1/adsets/evidence?metric=roas').expect(200);
    expect(body.reasonKey).toBe('COMPARISON_ENVELOPE_UNAVAILABLE');
    expect(body.evidence).toBeNull();
  });
});

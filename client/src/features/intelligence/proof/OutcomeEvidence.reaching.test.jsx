// P7-07C: raw MetricSnapshot-shaped rows traverse the real daily reader,
// outcome service, HTTP route, response schema, hook and component. Only the
// database/connector capability and HTTP transport are substituted. The DB
// integration suite independently verifies these fields on persisted rows.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import express from 'express';
import request from 'supertest';

const { db, get } = vi.hoisted(() => ({
  db: { decision: { findFirst: vi.fn() }, campaign: { findFirst: vi.fn() }, metricSnapshot: { findMany: vi.fn() } }, get: vi.fn(),
}));
vi.mock('../../../../../src/lib/prisma.js', () => ({ prisma: db }));
vi.mock('../../../../../src/utils/logger.js', () => ({ logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../../src/services/connectors/connectorRegistry.js', () => ({ resolve: () => ({ fetchDailyRaw() {}, normalizeDaily() {} }) }));
vi.mock('../../../../../src/services/decision-accuracy/DecisionAccuracyService.js', () => ({
  getAccuracy: vi.fn(), recordOutcome: vi.fn(), listPendingOutcomes: vi.fn(), validateOutcomeBody: vi.fn(), OUTCOME_ERROR: {},
}));
vi.mock('@/lib/api.js', () => ({ api: { get } }));

import { accuracyRouter } from '../../../../../src/routes/lumi/accuracy.js';
import { comparisonWindows } from '../../../../../src/services/decision-accuracy/comparisonWindow.js';
import { OutcomeEvidenceResponseSchema } from '@/contracts/schemas';
import OutcomeEvidence from './OutcomeEvidence.jsx';

const boundary = new Date('2026-08-10T09:30:00.000Z');
const policy = comparisonWindows(boundary);
const raw = (day, over = {}) => ({ id: day, workspaceId: 'ws', entityId: 'entity', entityLevel: 'CAMPAIGN',
  source: 'META', measurementWindow: 'DAILY', date: new Date('2026-08-20T08:00:00.000Z'),
  windowStart: new Date(day), windowEnd: new Date(day), spendMinor: 50000, revenueMinor: 100000,
  currency: 'EGP', currencyProvenance: 'PLATFORM_REPORTED', ...over });
const app = express();
app.use((req, res, next) => { req.workspaceId = 'ws'; req.collabRole = 'STRATEGIST'; next(); });
app.use('/api/lumi', accuracyRouter);
let rawRows; let response;
beforeEach(() => {
  vi.clearAllMocks();
  db.decision.findFirst.mockResolvedValue({ id: 'decision', entityId: 'entity', entityLevel: 'CAMPAIGN', verdict: 'KILL', humanExecutedAt: boundary });
  db.campaign.findFirst.mockResolvedValue({ channel: 'META' });
  rawRows = [...policy.baseline.days.map(day => raw(day)), ...policy.observation.days.map(day => raw(day, { spendMinor: 25000, revenueMinor: 0 }))];
  db.metricSnapshot.findMany.mockImplementation(async ({ select }) => rawRows.map(row => Object.fromEntries(
    Object.keys(select).map(key => [key, row[key] ?? null]))));
  get.mockImplementation(async url => {
    response = await request(app).get(url);
    expect(response.status).toBe(200);
    return { data: response.body };
  });
});

describe('P7-07C real reaching read contract', () => {
  it('carries authoritative EGP through raw rows, daily selection, HTTP, schema, hook and UI', async () => {
    render(<OutcomeEvidence decisionId="decision" />);
    await screen.findByText('What Lumi observed');
    const admitted = OutcomeEvidenceResponseSchema.parse(response.body);
    for (const side of [admitted.baseline, admitted.observation, admitted.delta]) expect(side).toMatchObject({ currency: 'EGP', currencyProvenance: 'PLATFORM_REPORTED' });
    expect(admitted.baseline.spendMinor).toBe(350000);
    expect(admitted.observation.revenueMinor).toBe(0);
    expect(admitted.observation.roas).toBe(0);
    expect(admitted.delta.spendMinor).toBe(-175000);
    expect(admitted.baseline.refs).toHaveLength(7);
    expect(db.metricSnapshot.findMany.mock.calls[0][0]).toMatchObject({ where: { workspaceId: 'ws', source: 'META', measurementWindow: 'DAILY' }, select: { currencyProvenance: true } });
    const spend = within(screen.getByRole('region', { name: 'Observed performance records' })).getByRole('article', { name: 'Spend evidence' });
    expect(spend.textContent).toMatch(/EGP|ج\.م/);
    expect(spend.textContent).not.toContain('$');
  });
  it.each([{ currency: 'USD' }, { currency: null }, { currencyProvenance: 'LEGACY_UNKNOWN' }])(
    'unsafe contributing money reaches reason-specific refusal without monetary comparison %j', async unsafe => {
      Object.assign(rawRows[7], unsafe);
      render(<OutcomeEvidence decisionId="decision" currency="USD" />);
      await screen.findByText(/authoritative denomination/);
      expect(OutcomeEvidenceResponseSchema.safeParse(response.body).success).toBe(true);
      expect(response.body).toMatchObject({ status: 'NOT_MEASURABLE', reason: 'MONETARY_BASIS_UNAVAILABLE',
        observation: { spendMinor: null, revenueMinor: null, currency: null, currencyProvenance: null },
        delta: { spendMinor: null, revenueMinor: null, roas: null, currency: null, currencyProvenance: null } });
      expect(response.body.observation.refs).toHaveLength(7);
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Observed performance records' })).not.toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/\$|EGP|3,500|Observed change/);
    });
  it('the hook rejects unproved numeric money instead of permitting the USD formatter default', async () => {
    get.mockImplementation(async url => {
      response = await request(app).get(url);
      response.body.baseline.currency = null;
      return { data: response.body };
    });
    render(<OutcomeEvidence decisionId="decision" currency="USD" />);
    await screen.findByText('Evidence could not be read');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\$|3,500|Observed change/);
  });
});

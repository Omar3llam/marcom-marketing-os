import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import express from 'express';
import request from 'supertest';
const { db, get } = vi.hoisted(() => ({ db: { metricSnapshot: { findMany: vi.fn() }, campaign: { findMany: vi.fn() } }, get: vi.fn() }));
vi.mock('../../../../../src/lib/prisma.js', () => ({ prisma: db }));
vi.mock('../../../../../src/utils/logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../../src/services/connectors/credentialStore.js', () => ({ listConnections: vi.fn(async () => []) }));
vi.mock('../../../../../src/middleware/requirePlan.js', () => ({ requirePlan: () => (req, res, next) => next() }));
vi.mock('@/lib/api.js', () => ({ api: { get } }));
import { portfolioRouter } from '../../../../../src/routes/lumi/portfolio.js';
import { BlendedTruthSchema } from '@/contracts/schemas';
import { useBlendedTruth } from '@/hooks/useBlendedTruth.js';
import { BlendedTruthView } from './BlendedTruthView.jsx';
const app = express(); app.use((req, res, next) => { req.workspaceId = 'ws'; next(); }); app.use('/api/lumi', portfolioRouter);
function Read() { const { data, loading, error } = useBlendedTruth(); return loading ? <p>Loading</p> : error ? <p>Contract read failed</p> : <BlendedTruthView data={data} />; }
const raw = (source, entityId = 'a', over = {}) => ({ entityId, source, date: new Date(), spendMinor: source === 'META' ? 25000 : null,
  revenueMinor: source === 'META' ? 100000 : 75000, currency: 'EGP', currencyProvenance: 'PLATFORM_REPORTED', measurementWindow: 'ROLLING_WINDOW',
  spendWindowStartUtc: new Date('2026-08-01'), spendWindowEndUtc: new Date('2026-08-30'),
  windowStart: new Date('2026-08-01'), windowEnd: new Date('2026-08-30'), ...over });
let rows, response;
beforeEach(() => {
  vi.clearAllMocks(); rows = [raw('META'), raw('GA4')];
  db.campaign.findMany.mockResolvedValue([{ id: 'a', name: 'Summer', channel: 'META' }]);
  db.metricSnapshot.findMany.mockImplementation(async ({ select }) => rows.map(r => Object.fromEntries(Object.keys(select).map(k => [k, r[k] ?? null]))));
  get.mockImplementation(async url => { response = await request(app).get(url); expect(response.status).toBe(200); return { data: response.body }; });
});
const show = () => render(<MemoryRouter><Read /></MemoryRouter>);
const table = () => screen.getByRole('table', { name: 'Channel revenue evidence comparison' });
describe('real Blended endpoint → required schema → hook → view', () => {
  it('AVAILABLE survives raw evidence through the reaching path', async () => {
    show(); await screen.findByRole('table'); const admitted = BlendedTruthSchema.parse(response.body);
    expect(admitted.channels[0].reconciliation).toMatchObject({ status: 'AVAILABLE', gapMinor: 25000, gapPct: .25, currency: 'EGP' });
    expect(within(table()).getByText(/25% above/)).toHaveTextContent(/EGP|ج\.م/);
    expect(table()).toHaveTextContent('2026-08-01 → 2026-08-30');
    expect(table()).not.toHaveTextContent('$');
  });
  it('UNAVAILABLE mismatch refuses a gap but retains actual revenue', async () => {
    Object.assign(rows[1], { windowStart: new Date('2026-09-01'), windowEnd: new Date('2026-09-30') });
    show(); await screen.findByRole('table'); expect(BlendedTruthSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.channels[0]).toMatchObject({ actualRevenueMinor: 75000, blendedRevenueMinor: 75000, gapMinor: null,
      reconciliation: { status: 'UNAVAILABLE', reason: 'MEASUREMENT_WINDOW_MISMATCH' } });
    expect(table()).toHaveTextContent('different periods'); expect(table()).not.toHaveTextContent(/25%|Match|Reconciled/);
  });
  it('UNVERIFIED cannot become zero or MATCH', async () => {
    rows = [rows[0]]; show(); await screen.findByRole('table'); expect(response.body.channels[0].gapMinor).toBeNull();
    expect(table()).toHaveTextContent('Unverified'); expect(table()).not.toHaveTextContent(/0%|Match/);
  });
  it('valid zero platform revenue retains its absolute difference through schema and UI', async () => {
    rows[0].revenueMinor = 0; show(); await screen.findByRole('table');
    expect(BlendedTruthSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.channels[0].reconciliation).toMatchObject({ status: 'AVAILABLE', gapMinor: -75000, gapPct: null, gapPctReason: 'ZERO_PLATFORM_DENOMINATOR' });
    expect(table()).toHaveTextContent('below'); expect(table()).toHaveTextContent('Percentage unavailable');
    expect(table()).not.toHaveTextContent(/0%|100%|Match/);
  });
  it('partial portfolio explicitly excludes an unverified population from its denominator', async () => {
    rows.push(raw('META', 'b'), raw('GA4', 'b'), raw('META', 'c'));
    show(); await screen.findByText(/Across 2 of 3/);
    expect(response.body.portfolio.reconciliation).toMatchObject({ status: 'AVAILABLE', gapPct: .25, platformRevenueMinor: 200000, actualRevenueMinor: 150000 });
    expect(screen.getByText(/Across 2 of 3/)).toHaveTextContent('partial population');
  });
  it('the hook refuses contradictory monetary aliases instead of rendering them', async () => {
    const getReal = get.getMockImplementation(); get.mockImplementation(async url => { const result = await getReal(url); result.data.channels[0].gapMinor = 0; return result; });
    show(); await screen.findByText('Contract read failed'); expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

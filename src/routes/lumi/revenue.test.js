// ============================================================
// POST /api/lumi/revenue/csv — role gate + input caps
// ------------------------------------------------------------
// STRATEGIST-only; a BUYER is 403'd. Body is capped at 500 rows and must be a
// non-empty array. The service is mocked — this pins the route contract, not the
// matching logic (covered in RevenueCsvService.test.js).
// ============================================================
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { processRevenueCsv } = vi.hoisted(() => ({ processRevenueCsv: vi.fn() }));
vi.mock('../../services/revenue/RevenueCsvService.js', () => ({
  processRevenueCsv,
  MAX_REVENUE_CSV_ROWS: 500,
}));
vi.mock('../../lib/prisma.js', () => ({
  prisma: { user: { findUnique: vi.fn().mockResolvedValue({ workspaceId: 'ws1' }) } },
}));
vi.mock('../../utils/logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { revenueRouter } from './revenue.js';

function makeApp({ collabRole } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = 'firebase-user-1';
    req.workspaceId = 'ws1';
    if (collabRole !== undefined) req.collabRole = collabRole;
    next();
  });
  app.use('/', revenueRouter);
  return app;
}

const ROW = { campaignIdentifier: 'Folla', revenueAmount: '100', currency: 'EGP' };

beforeEach(() => {
  vi.clearAllMocks();
  processRevenueCsv.mockResolvedValue({ matched: 1, updated: 1, unmatched: [], errors: [] });
});

describe('POST /revenue/csv', () => {
  it('403s a BUYER (STRATEGIST surface)', async () => {
    const res = await request(makeApp({ collabRole: 'BUYER' })).post('/revenue/csv').send({ rows: [ROW] }).expect(403);
    expect(res.body.error).toBe('RoleForbidden');
    expect(processRevenueCsv).not.toHaveBeenCalled();
  });

  it('403s a CLIENT', async () => {
    await request(makeApp({ collabRole: 'CLIENT' })).post('/revenue/csv').send({ rows: [ROW] }).expect(403);
  });

  it('lets a STRATEGIST through and returns the service result', async () => {
    const res = await request(makeApp({ collabRole: 'STRATEGIST' })).post('/revenue/csv').send({ rows: [ROW] }).expect(200);
    expect(res.body).toMatchObject({ matched: 1, updated: 1 });
    expect(processRevenueCsv).toHaveBeenCalledWith('ws1', [ROW]);
  });

  it('null collabRole is treated as STRATEGIST (seed default)', async () => {
    await request(makeApp({ collabRole: null })).post('/revenue/csv').send({ rows: [ROW] }).expect(200);
  });

  it('501 rows → 400 TooManyRows (before touching the service)', async () => {
    const rows = Array.from({ length: 501 }, () => ROW);
    const res = await request(makeApp({ collabRole: 'STRATEGIST' })).post('/revenue/csv').send({ rows }).expect(400);
    expect(res.body.error).toBe('TooManyRows');
    expect(processRevenueCsv).not.toHaveBeenCalled();
  });

  it('exactly 500 rows is allowed', async () => {
    const rows = Array.from({ length: 500 }, () => ROW);
    await request(makeApp({ collabRole: 'STRATEGIST' })).post('/revenue/csv').send({ rows }).expect(200);
  });

  it('empty array → 400 EmptyUpload; non-array → 400 InvalidBody', async () => {
    await request(makeApp({ collabRole: 'STRATEGIST' })).post('/revenue/csv').send({ rows: [] }).expect(400)
      .then((r) => expect(r.body.error).toBe('EmptyUpload'));
    await request(makeApp({ collabRole: 'STRATEGIST' })).post('/revenue/csv').send({ rows: 'nope' }).expect(400)
      .then((r) => expect(r.body.error).toBe('InvalidBody'));
  });
});

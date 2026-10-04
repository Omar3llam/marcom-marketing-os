import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../lib/prisma.js', () => ({
  prisma: { decision: { findMany: vi.fn() } },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../lib/prisma.js';
import { accuracyRouter } from './accuracy.js';

// Only DB I/O is mocked: the service projection, engine, surface and route are
// real, so membership cannot be supplied by a mocked service response.
const app = express();
app.use((req, _res, next) => { req.workspaceId = 'ws-proof'; next(); });
app.use('/api/lumi', accuracyRouter);

function rows(label, error, count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${label}-${i}`, verdict: 'KILL', confidence: 1 - error, status: 'PROPOSED',
    createdAt: new Date(`${label}-10T00:00:00Z`),
    humanExecutedAt: new Date(`${label}-11T00:00:00Z`), platformExecutedAt: null, dismissedAt: null,
    outcomes: [{ spendDeltaMinor: -100, roasDelta: 0, sustained: true, windowEnd: new Date('2026-02-20T00:00:00Z') }],
  }));
}

beforeEach(() => { vi.clearAllMocks(); });

describe('P7-06A — GET accuracy publishes engine authority without route-side derivation', () => {
  it('publishes the actual fit subset through the real service and engine', async () => {
    prisma.decision.findMany.mockResolvedValue([
      ...rows('2025-11', 0.9, 2), ...rows('2025-12', 0.1, 30), ...rows('2026-01', 0.1, 30),
    ]);
    const res = await request(app).get('/api/lumi/accuracy').expect(200);
    expect(prisma.decision.findMany.mock.calls[0][0].where.workspaceId).toBe('ws-proof');
    expect(res.body.velocity).toEqual({
      periods: [
        { label: '2025-11', calibrationError: 0.9, sampleSize: 2, includedInTrend: false },
        { label: '2025-12', calibrationError: 0.1, sampleSize: 30, includedInTrend: true },
        { label: '2026-01', calibrationError: 0.1, sampleSize: 30, includedInTrend: true },
      ],
      trend: 'FLAT', slope: 0,
    });
  });

  it.each([
    [0, 'FLAT', 'holding steady'],
    [0.4, 'DEGRADING', 'degrading'],
  ])('publishes the zero → %s status %s and its existing surface consequence', async (recent, status, verb) => {
    prisma.decision.findMany.mockResolvedValue([...rows('2025-11', 0, 50), ...rows('2026-01', recent, 50)]);
    const res = await request(app).get('/api/lumi/accuracy').expect(200);
    expect(res.body.accountLift).toMatchObject({ status, calibrationImprovementPct: null });
    expect(res.body.surface).toMatchObject({ gated: false, status, improvementPct: null, knowledge: 'KNOWN' });
    expect(res.body.surface.headline).toContain(`— ${verb}`);
    if (recent > 0) expect(res.body.surface.headline).not.toContain('holding steady');
  });
});

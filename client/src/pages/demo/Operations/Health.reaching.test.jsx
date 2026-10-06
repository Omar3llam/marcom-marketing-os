import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import express from 'express';
import request from 'supertest';
const { db, get } = vi.hoisted(() => ({ db: { executionRequest: { count: vi.fn(), findMany: vi.fn() }, executionMetric: { findMany: vi.fn() } }, get: vi.fn() }));
vi.mock('../../../../../src/lib/prisma.js', () => ({ prisma: db }));
vi.mock('../../../../../src/utils/logger.js', () => ({ logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../../src/queues/index.js', () => ({ executionQueue: null }));
vi.mock('../../../../../src/services/execution/workerHealth.js', () => ({ getWorkerHeartbeats: async () => [] }));
vi.mock('@/lib/api.js', () => ({ api: { get } }));
import { registerVitalsRoute } from '../../../../../src/routes/execution/vitals.js';
import { registerMetricsSummaryRoute } from '../../../../../src/routes/execution/metrics.js';
import { RuntimeHealthStrip } from './components/RuntimeHealthStrip.jsx';
const app = express(), router = express.Router();
app.use((req, res, next) => { req.workspaceId = 'ws'; next(); });
registerVitalsRoute(router); registerMetricsSummaryRoute(router); app.use('/api/execute', router);
const responseBodies = {};
beforeEach(() => {
  vi.clearAllMocks(); db.executionRequest.count.mockResolvedValue(0); db.executionRequest.findMany.mockResolvedValue([]);
  db.executionMetric.findMany.mockResolvedValue([]);
  get.mockImplementation(async url => { const res = await request(app).get(url); responseBodies[url] = res.body; if (res.status !== 200) throw Error(res.body.error); return { data: res.body }; });
});
describe('P7-08 real vitals/metrics aggregation → independent source groups', () => {
  it('real empty source populations retain count zero, null p95 and historical N/A', async () => {
    render(<RuntimeHealthStrip />); await screen.findByText('No execution metrics in this 7-day window');
    expect(responseBodies['/api/execute/vitals']).toMatchObject({ inFlightCount: 0, p95LatencyMs: null, windowMinutes: 60 });
    expect(responseBodies['/api/execute/metrics/summary']).toMatchObject({ total_executions: 0, success_rate: null, avg_execution_ms: null, windowDays: 7 });
    expect(screen.getByText('Runtime, last 60 min')).toBeInTheDocument();
    expect(screen.getByText('p95 latency').parentElement).toHaveTextContent('—');
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });
  it('real terminal rows and recorded executions retain published durations and success measurement', async () => {
    db.executionRequest.findMany.mockResolvedValue([{ createdAt: '2026-10-06T10:00:00Z', updatedAt: '2026-10-06T10:00:02Z' }]);
    db.executionMetric.findMany.mockResolvedValue([{ finalStatus: 'EXECUTED_SUCCESS', executionMs: 2000, queueWaitMs: 0, retryCount: 0, timeoutOccurred: false, agentUsed: 'worker' }]);
    render(<RuntimeHealthStrip />); await screen.findByText('100%');
    expect(responseBodies['/api/execute/vitals'].p95LatencyMs).toBe(2000);
    expect(responseBodies['/api/execute/metrics/summary']).toMatchObject({ total_executions: 1, avg_execution_ms: 2000, success_rate: 1 });
    expect(screen.getAllByText('2.0s')).toHaveLength(2);
  });
  it.each(['vitals', 'metrics'])('real %s route failure preserves the other available source', async failing => {
    if (failing === 'vitals') db.executionRequest.count.mockRejectedValue(Error('DB offline'));
    else db.executionMetric.findMany.mockRejectedValue(Error('DB offline'));
    render(<RuntimeHealthStrip />);
    await screen.findByText(failing === 'vitals' ? 'Runtime vitals unavailable' : 'Historical metrics unavailable');
    expect(screen.getByText(failing === 'vitals' ? 'No execution metrics in this 7-day window' : 'Runtime, last 60 min')).toBeInTheDocument();
  });
});

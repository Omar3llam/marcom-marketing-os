import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import express from 'express';
import request from 'supertest';
const { db, get } = vi.hoisted(() => ({ db: { executionRequest: { groupBy: vi.fn(), findMany: vi.fn(), count: vi.fn() } }, get: vi.fn() }));
vi.mock('../../../src/lib/prisma.js', () => ({ prisma: db }));
vi.mock('../../../src/utils/logger.js', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/lib/api.js', () => ({ api: { get } }));
import { liveRouter } from '../../../src/routes/observability/live.js';
import Observability from './Observability.jsx';
import { MetricsSummary } from '@/components/observability/MetricsSummary.jsx';
const app = express(); app.use((req, res, next) => { req.workspaceId = 'ws'; next(); }); app.use('/api/observability', liveRouter);
let body;
beforeEach(() => {
  vi.clearAllMocks();
  db.executionRequest.groupBy.mockResolvedValue([]);
  db.executionRequest.findMany.mockResolvedValue([]);
  db.executionRequest.count.mockResolvedValue(0);
  get.mockImplementation(async url => {
    if (url.endsWith('/providers')) return { data: { providers: [] } };
    if (url.endsWith('/failures')) return { data: { failures: [] } };
    const response = await request(app).get(url); expect(response.status).toBe(200); body = response.body; return { data: body };
  });
});
afterEach(() => vi.useRealTimers());
describe('P7-08 DB-shaped counts → real live route → admission → activity summary', () => {
  it('preserves count zero and makes empty queue wait explicitly not applicable', async () => {
    render(<Observability />);
    await screen.findByText('Execution activity');
    expect(body.queue).toEqual({ depth: 0, avg_wait_ms: null, oldest_queued_at: null });
    expect(screen.getByText('Avg wait:').parentElement).toHaveTextContent('Not applicable');
    expect(screen.getByText('Queue depth:').parentElement).toHaveTextContent('0');
    const activity = screen.getByText('Execution activity').closest('section');
    expect(within(activity).getByText('Failed (1h)').parentElement).toHaveTextContent('0');
    expect(activity.textContent).not.toMatch(/Execution Health|▶|⏸|⏳|✖/);
    expect(activity.querySelector('[class*="signal-"]')).toBeNull();
    expect(screen.getByText(/Last update:/)).not.toHaveTextContent('—');
  });
  it.each([0, 1500])('real queue measurement %i is distinct from no queue', async wait => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
    db.executionRequest.findMany.mockImplementation(({ select }) => Promise.resolve(select.updatedAt ? [] : [{ id: 'q', createdAt: new Date(Date.now() - wait) }]));
    render(<Observability />); await screen.findByText('Execution activity');
    expect(body.queue).toMatchObject({ depth: 1, avg_wait_ms: wait });
    expect(screen.getByText('Avg wait:').parentElement).toHaveTextContent(wait === 0 ? '0ms' : '1.5s');
    expect(screen.queryByText('Not applicable')).not.toBeInTheDocument();
  });
  it('malformed successful live response never reaches zero summary cards', async () => {
    const real = get.getMockImplementation(); get.mockImplementation(async url => {
      const result = await real(url); if (url.endsWith('/live')) delete result.data.executions.failed_last_hour; return result;
    });
    render(<Observability />); await screen.findByRole('alert');
    expect(screen.queryByText('Execution activity')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed (1h)')).not.toBeInTheDocument();
  });
  it('failed request is explicit and publishes no activity measurements', async () => {
    get.mockRejectedValue(new Error('source offline'));
    render(<Observability />); expect(await screen.findByRole('alert')).toHaveTextContent('source offline');
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });
  it('the summary itself refuses missing measurements rather than manufacturing zeros', () => {
    render(<MetricsSummary liveData={{ executions: { active: 0 } }} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Failed (1h)')).not.toBeInTheDocument();
  });
});

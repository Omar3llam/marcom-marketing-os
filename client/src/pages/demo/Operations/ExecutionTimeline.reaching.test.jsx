import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import express from 'express';
import request from 'supertest';
const { db, get } = vi.hoisted(() => ({ db: { executionRequest: { findUnique: vi.fn() }, executionTransition: { findMany: vi.fn() } }, get: vi.fn() }));
vi.mock('../../../../../src/lib/prisma.js', () => ({ prisma: db }));
vi.mock('../../../../../src/utils/logger.js', () => ({ logger: { debug: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api.js', () => ({ api: { get } }));
import { registerTransitionsRoute } from '../../../../../src/routes/execution/transitions.js';
import { ExecutionTimeline } from './ExecutionTimeline.jsx';
import { TransitionRow } from './TimelineRow.jsx';
const app = express(), router = express.Router();
app.use((req, res, next) => { req.workspaceId = 'ws'; next(); }); registerTransitionsRoute(router); app.use('/api/execute', router);
const exec = { id: 'execution-123456', workspaceId: 'ws', actionType: 'PAUSE_CAMPAIGN', status: 'TIMED_OUT', version: 4, correlationId: 'corr-123' };
const rows = ['QUEUED', 'EXECUTING', 'RETRYING', 'TIMED_OUT'].map((toStatus, i, arr) => ({ id: 'transition-' + i, fromStatus: i ? arr[i - 1] : 'PENDING', toStatus,
  actor: i === 3 ? 'timeout_handler' : 'worker', previousVersion: i, newVersion: i + 1,
  reason: i === 2 ? 'Retry after provider failure; request remains correlated' : i === 3 ? 'Runtime timeout reached' : null,
  metadata: i === 2 ? { occConflict: true } : null, createdAt: new Date(Date.UTC(2026, 9, 6, 10, 0, i * 10)).toISOString() }));
beforeEach(() => {
  vi.clearAllMocks(); db.executionRequest.findUnique.mockResolvedValue(exec); db.executionTransition.findMany.mockResolvedValue(rows);
  get.mockImplementation(async url => { const response = await request(app).get(url); if (response.status !== 200) throw Error(response.body.error); return { data: response.body }; });
});
describe('P7-08 persisted-shaped transitions → actual route → event timeline', () => {
  it('keeps chronological history primary and compact metadata derived from the returned rows', async () => {
    render(<ExecutionTimeline executionId={exec.id} onBack={vi.fn()} />);
    const events = await screen.findByRole('list', { name: 'Transition history' });
    expect(within(events).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText(/4 transitions · 1 retry · 1 OCC conflict · 1 timeout/)).toHaveTextContent('observed span 30.00s');
    expect(screen.queryByText('Wall time')).not.toBeInTheDocument();
    expect(events).toHaveTextContent('Retry after provider failure; request remains correlated');
    expect(events).toHaveTextContent('timeout_handler'); expect(events).toHaveTextContent('10:00:30.000');
    expect(db.executionTransition.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { executionId: exec.id, workspaceId: 'ws' }, orderBy: { createdAt: 'asc' } }));
    expect(get).toHaveBeenCalledWith('/api/execute/' + exec.id + '/transitions');
  });
  it('successfully read zero transitions produces no synthetic zero summary', async () => {
    db.executionTransition.findMany.mockResolvedValue([]);
    render(<ExecutionTimeline executionId={exec.id} onBack={vi.fn()} />);
    await screen.findByText('No transitions recorded');
    expect(screen.queryByText(/0 transitions|0 retries|observed span/)).not.toBeInTheDocument();
  });
  it('failed transition read is not no transitions', async () => {
    db.executionTransition.findMany.mockRejectedValue(Error('offline'));
    render(<ExecutionTimeline executionId={exec.id} onBack={vi.fn()} />);
    await screen.findByText('Could not load timeline'); expect(screen.queryByText('No transitions recorded')).not.toBeInTheDocument();
  });
  it('a missing transition population is a contract error, never no recorded events', async () => {
    get.mockResolvedValue({ data: { execution: exec } });
    render(<ExecutionTimeline executionId={exec.id} onBack={vi.fn()} />);
    await screen.findByText('Could not load timeline');
    expect(screen.queryByText('No transitions recorded')).not.toBeInTheDocument();
  });
  it('an event row keeps labelled actor, timestamp, duration and its full reason', () => {
    render(<TransitionRow r={{ ...rows[2], deltaMs: 10000, overageMs: null, occConflict: true }} last />);
    expect(screen.getByText('Actor')).toBeInTheDocument(); expect(screen.getByText('Timestamp')).toBeInTheDocument();
    expect(screen.getByText('Interval')).toBeInTheDocument(); expect(screen.getByText('10.00s')).toBeInTheDocument();
    const reason = screen.getByText(rows[2].reason); expect(reason.style.whiteSpace).not.toBe('nowrap');
    expect(reason.style.overflow).not.toBe('hidden');
  });
});

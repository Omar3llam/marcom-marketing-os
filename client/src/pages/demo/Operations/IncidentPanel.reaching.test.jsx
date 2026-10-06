import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import express from 'express';
import request from 'supertest';
const { db, get } = vi.hoisted(() => ({ db: { executionRequest: { findUnique: vi.fn() }, executionTransition: { findMany: vi.fn() } }, get: vi.fn() }));
vi.mock('../../../../../src/lib/prisma.js', () => ({ prisma: db }));
vi.mock('../../../../../src/utils/logger.js', () => ({ logger: { debug: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api.js', () => ({ api: { get } }));
import { registerIncidentRoute } from '../../../../../src/routes/execution/incident.js';
import { IncidentPanel } from './IncidentPanel.jsx';
const app = express(), router = express.Router(); app.use((req, res, next) => { req.workspaceId = 'ws'; next(); });
registerIncidentRoute(router); app.use('/api/execute', router);
let body;
beforeEach(() => {
  vi.clearAllMocks(); db.executionRequest.findUnique.mockResolvedValue({ id: 'exec', workspaceId: 'ws', status: 'TIMED_OUT', actionType: 'PAUSE_CAMPAIGN', version: 2, correlationId: 'corr' });
  db.executionTransition.findMany.mockResolvedValue([
    { id: 'a', fromStatus: 'QUEUED', toStatus: 'EXECUTING', actor: 'worker', previousVersion: 0, newVersion: 1, createdAt: '2026-10-06T10:00:00Z' },
    { id: 'b', fromStatus: 'EXECUTING', toStatus: 'TIMED_OUT', actor: 'timeout_handler', reason: 'Real persisted timeout reason', previousVersion: 1, newVersion: 2, createdAt: '2026-10-06T10:00:30Z' },
  ]);
  get.mockImplementation(async url => { const r = await request(app).get(url); body = r.body; if (r.status !== 200) throw Error(body.error); return { data: body }; });
});
describe('P7-08 real incident projection → retained collision evidence', () => {
  it('every graph state/actor originates from the actual incident route projection', async () => {
    render(<IncidentPanel executionId="exec" onBack={vi.fn()} />); await screen.findByText('Collision resolution');
    expect(body.incident.graph).toEqual({ from: 'EXECUTING', winner: 'timeout_handler', loser: 'worker', resolution: 'TIMED_OUT' });
    expect(screen.getAllByText('Real persisted timeout reason')).toHaveLength(2);
    expect(screen.getByText('Resolved to').parentElement).toHaveTextContent('TIMED_OUT');
    expect(document.body.textContent).not.toMatch(/DAG validated|8 nodes|9 edges/);
  });
  it('no transitions means no fabricated incident topology', async () => {
    db.executionTransition.findMany.mockResolvedValue([]);
    render(<IncidentPanel executionId="exec" onBack={vi.fn()} />); await screen.findByText('No incident for this execution');
    expect(screen.queryByText('Collision resolution')).not.toBeInTheDocument();
  });
  it('failed incident read is explicit', async () => {
    db.executionTransition.findMany.mockRejectedValue(Error('offline'));
    render(<IncidentPanel executionId="exec" onBack={vi.fn()} />); await screen.findByText('Could not load incident');
    expect(screen.queryByText('No incident for this execution')).not.toBeInTheDocument();
  });
  it('missing incident authority does not become no incident', async () => {
    get.mockResolvedValue({ data: { execution: { id: 'exec' }, transitions: [] } });
    render(<IncidentPanel executionId="exec" onBack={vi.fn()} />);
    await screen.findByText('Could not load incident');
    expect(screen.queryByText('No incident for this execution')).not.toBeInTheDocument();
  });
});

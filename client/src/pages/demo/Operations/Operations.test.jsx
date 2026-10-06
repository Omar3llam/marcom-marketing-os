import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const { get, connect } = vi.hoisted(() => ({ get: vi.fn(), connect: vi.fn(() => () => {}) }));
vi.mock('@/lib/api.js', () => ({ api: { get } }));
vi.mock('@/lib/events.js', () => ({ connectExecutionStream: connect }));
vi.mock('@/firebase.js', () => ({ auth: { currentUser: null } }));
import Operations from './index.jsx';
import { LiveMonitor } from './LiveMonitor.jsx';
const execution = { id: 'execution-123456', actionType: 'PAUSE_CAMPAIGN', targetId: 'campaign-123', status: 'EXECUTING', correlationId: 'corr-xyz', actor: 'worker', version: 4, createdAt: '2026-10-06T10:00:00Z', updatedAt: '2026-10-06T10:00:02Z' };
beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation(async url => ({ data: url.endsWith('/active') ? { executions: [execution] } : url.endsWith('/vitals')
    ? { inFlightCount: 1, successPerHour: 0, failedPerHour: 0, p95LatencyMs: null, windowMinutes: 60, serverNow: '2026-10-06T10:00:00Z' }
    : { total_executions: 0, avg_execution_ms: null, success_rate: null, windowDays: 7 } }));
});
describe('P7-08 reachable operational events', () => {
  it('Operations offers only evidence-backed tabs, without a static runtime graph', async () => {
    render(<Operations />); await screen.findByRole('article', { name: 'Execution 123456' });
    expect(screen.queryByRole('button', { name: 'Workflow Graph' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Live Monitor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Execution Timeline' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Incident Panel' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/8 nodes|9 edges|DAG validated|decision_engine/);
  });
  it('transport is a static explicit client fact, not a runtime-health pulse', async () => {
    connect.mockImplementation((token, callbacks) => { callbacks.onConnected(); return () => {}; });
    const { container } = render(<LiveMonitor onOpen={vi.fn()} onOpenIncident={vi.fn()} />);
    await screen.findByText(/SSE connected/);
    const transport = screen.getByText(/SSE connected/);
    expect(transport.innerHTML).not.toContain('intel-pulse');
    expect(container.textContent).not.toMatch(/System live|Healthy|Watching/);
  });
  it('execution records retain source facts and keyboard navigation, without a fabricated version zero', async () => {
    get.mockResolvedValue({ data: { executions: [{ ...execution, version: null, actor: null }] } });
    const open = vi.fn(); render(<LiveMonitor onOpen={open} onOpenIncident={vi.fn()} />);
    const record = await screen.findByRole('article', { name: /Execution 123456/ });
    expect(record).toHaveTextContent('PAUSE_CAMPAIGN'); expect(record).toHaveTextContent('campaign-123');
    expect(record).toHaveTextContent('corr-xyz'); expect(record.textContent).not.toContain('v0');
    fireEvent.click(screen.getByRole('button', { name: /Open execution #123456/ })); expect(open).toHaveBeenCalledWith(execution.id);
  });
  it('load failure is not an empty execution population', async () => {
    get.mockRejectedValue(Error('offline'));
    render(<LiveMonitor onOpen={vi.fn()} onOpenIncident={vi.fn()} />);
    await screen.findByText('Could not load executions');
    expect(screen.queryByText('No executions match this filter')).not.toBeInTheDocument();
  });
  it('missing execution population is a read error, never idle runtime', async () => {
    get.mockResolvedValue({ data: {} });
    render(<LiveMonitor onOpen={vi.fn()} onOpenIncident={vi.fn()} />);
    await screen.findByText('Could not load executions');
    expect(screen.queryByText('No executions match this filter')).not.toBeInTheDocument();
  });
});

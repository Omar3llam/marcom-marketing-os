import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api.js', () => ({ api: { get } }));
import { RuntimeHealthStrip } from './components/RuntimeHealthStrip.jsx';
const vitals = { inFlightCount: 0, successPerHour: 2, failedPerHour: 0, p95LatencyMs: null, windowMinutes: 45, serverNow: '2026-10-06T10:00:00Z' };
const metrics = { total_executions: 10, success_rate: .91, avg_execution_ms: 2500, windowDays: 3 };
beforeEach(() => { vi.clearAllMocks(); get.mockImplementation(async url => ({ data: url.endsWith('/vitals') ? vitals : metrics })); });
describe('P7-08 independent measured windows', () => {
  it.each([.91, .80, .50])('success rate %s has no synthetic health band or pulse', async rate => {
    get.mockImplementation(async url => ({ data: url.endsWith('/vitals') ? vitals : { ...metrics, success_rate: rate } }));
    const { container } = render(<RuntimeHealthStrip />); await screen.findByText(`${Math.round(rate * 100)}%`);
    expect(screen.getByText('Runtime, last 45 min')).toBeInTheDocument();
    expect(screen.getByText('Execution history, last 3 days')).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/c-scale|c-hold|c-kill|intel-pulse|healthy|critical/);
    expect(screen.getByText('p95 latency').parentElement).toHaveTextContent('—');
    expect(screen.getByText('In-flight').parentElement).toHaveTextContent('0');
  });
  it('empty historical population is a known empty measurement, not 0% or 0ms', async () => {
    get.mockImplementation(async url => ({ data: url.endsWith('/vitals') ? vitals : { ...metrics, total_executions: 0, success_rate: null, avg_execution_ms: null } }));
    render(<RuntimeHealthStrip />); await screen.findByText('No execution metrics in this 3-day window');
    expect(screen.queryByText('0%')).not.toBeInTheDocument(); expect(screen.queryByText('0ms')).not.toBeInTheDocument();
  });
  it.each(['/vitals', '/metrics/summary'])('source failure %s does not hide the independently available group', async failure => {
    get.mockImplementation(async url => { if (url.endsWith(failure)) throw Error('offline'); return { data: url.endsWith('/vitals') ? vitals : metrics }; });
    render(<RuntimeHealthStrip />);
    await screen.findByText(failure === '/vitals' ? 'Runtime vitals unavailable' : 'Historical metrics unavailable');
    expect(screen.queryByText('!')).not.toBeInTheDocument();
    expect(screen.getByText(failure === '/vitals' ? '91%' : 'Runtime, last 45 min')).toBeInTheDocument();
  });
  it('malformed required runtime count fails that source instead of rendering undefined or zero', async () => {
    get.mockImplementation(async url => ({ data: url.endsWith('/vitals') ? { ...vitals, inFlightCount: undefined } : metrics }));
    render(<RuntimeHealthStrip />); await screen.findByText('Runtime vitals unavailable');
    expect(screen.getByText('91%')).toBeInTheDocument();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/lib/api.js';
import { useConnections } from './useConnections.js';
import ConnectionHealthStrip from '@/features/overview/components/ConnectionHealthStrip.jsx';
import ConnectorsView from '@/features/connectors/ConnectorsView.jsx';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));
vi.mock('@/hooks/useProjectId.js', () => ({ useProjectId: () => ({ projectId: 'p1' }) }));
const payload = () => ({ workspaceId: 'ws', connections: [{
  platform: 'META', isActive: true, connected: true, stale: false, connection: 'CONNECTED',
  readiness: 'CURRENT', availability: 'FAILING', completeness: 'INCOMPLETE',
  readinessKnowledge: 'KNOWN', availabilityKnowledge: 'KNOWN', completenessKnowledge: 'KNOWN',
  lastSuccessfulSync: new Date(Date.now() - 30 * 60_000).toISOString(),
  lastSyncedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  capabilities: [{ capability: 'EXECUTION', implemented: false, lastRun: 'NOT_APPLICABLE', lastRunKnowledge: 'CANNOT_ASK' }],
}] });
beforeEach(() => vi.resetAllMocks());
it('the real hook preserves all additive authority and future knowledge without mutation', async () => {
  const input = payload();
  input.connections[0].availabilityKnowledge = 'FUTURE_KNOWLEDGE';
  const snapshot = structuredClone(input);
  api.get.mockResolvedValue({ data: input });
  const { result } = renderHook(useConnections);
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBeNull();
  expect(result.current.data).toEqual(snapshot);
  expect(input).toEqual(snapshot);
});

describe.each([
  ['compact Overview', <ConnectionHealthStrip key="compact" compact />],
  ['full Overview', <ConnectionHealthStrip key="full" />],
  ['Channels', <ConnectorsView key="channels" />],
])('%s real request → schema → surface', (_, component) => {
  const mount = () => render(<MemoryRouter>{component}</MemoryRouter>);
  it('renders the resolved success clock and both adverse axes from the actual hook', async () => {
    api.get.mockResolvedValue({ data: payload() });
    const { container } = mount();
    await screen.findByText('Current · Last successful sync 30m ago');
    expect(container.textContent).toContain('Latest sync attempt failed');
    expect(container.textContent).toContain('Last successful sync was incomplete');
    expect(container.textContent).not.toContain('3d ago');
    expect(api.get).toHaveBeenCalledWith('/api/lumi/connections');
  });
  it.each(['transport', 'contract'])('%s failure cannot become an empty connection instruction', async (type) => {
    if (type === 'transport') api.get.mockRejectedValue(Object.assign(new Error('Request failed'), { httpStatus: 500 }));
    else api.get.mockResolvedValue({ data: { connections: 'invalid' } });
    mount();
    await screen.findByText(/Couldn't load (channel status|connections)/);
    expect(screen.queryByText(/Not connected|Never synced|^connect$|Connect →/)).not.toBeInTheDocument();
  });
  it('pending request is distinct from confirmed successful empty', async () => {
    let resolve;
    api.get.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const { container } = mount();
    expect(container.querySelector('.animate-pulse, [aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByText(/Not connected|^connect$|Connect →/)).not.toBeInTheDocument();
    await act(async () => resolve({ data: { workspaceId: null, connections: [] } }));
    await waitFor(() => expect(screen.getAllByText(/Not connected|^connect$/)).toHaveLength(2));
    expect(screen.queryByText(/Couldn't load/)).not.toBeInTheDocument();
  });
});

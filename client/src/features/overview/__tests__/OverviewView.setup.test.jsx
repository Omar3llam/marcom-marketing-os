import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/api/client';
import OverviewView from '../OverviewView.jsx';
import ConnectorsView from '@/features/connectors/ConnectorsView.jsx';
import { useCollabRole } from '@/hooks/useCollabRole.js';
import { useDismissals } from '../useDismissals.js';

// Only connections uses the real fetching hook. The actual hero, interrupts,
// strip and destination render the schema-validated response from this API mock.
vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));
vi.mock('@/hooks/useWorkspace.js', () => ({ useWorkspace: () => ({ workspace: { name: 'Acme', currency: 'USD' }, loading: false, status: 'PRESENT' }) }));
vi.mock('@/hooks/useProjectId.js', () => ({ useProjectId: () => ({ projectId: 'p1' }) }));
vi.mock('@/hooks/useConnectorCampaigns.js', () => ({ useConnectorCampaigns: () => ({ campaigns: [], loading: false, error: null }) }));
vi.mock('@/hooks/useAccountHealth.js', () => ({ useAccountHealth: () => ({ health: { campaigns: [], score: null, label: null }, loading: false, error: null }) }));
vi.mock('@/hooks/useConnectorVerdicts.js', () => ({ useConnectorVerdicts: () => ({ verdicts: [], loading: false, error: null }) }));
vi.mock('@/hooks/useHome.js', () => ({ useHome: () => ({ home: null, isStale: false, error: null }) }));
vi.mock('@/hooks/useAccuracy.js', () => ({ useAccuracy: () => ({ surface: null, loading: false, error: null }) }));
vi.mock('@/hooks/useAccountAggregate.js', () => ({ useAccountAggregate: () => ({ response: null, loading: false, error: null }) }));
vi.mock('@/hooks/useCollabRole.js', async (original) => ({ ...await original(), useCollabRole: vi.fn() }));
vi.mock('../useDismissals.js', () => ({ useDismissals: vi.fn() }));
vi.mock('../AgenticShellView.jsx', () => ({ default: () => null }));
vi.mock('../components/CopilotPanel.jsx', () => ({ default: () => null }));
beforeEach(() => {
  vi.resetAllMocks();
  useCollabRole.mockReturnValue({ role: 'STRATEGIST' });
  useDismissals.mockReturnValue({ firstRunFlag: false, dismissed: new Set(), dismiss: vi.fn() });
});
const mount = (component) => render(<MemoryRouter>{component}</MemoryRouter>);
const never = { platform: 'META', connected: true, isActive: true, stale: true, readiness: 'NEVER_SYNCED',
  availability: 'FAILING', completeness: 'NOT_RECORDED', lastSuccessfulSync: null };

describe('P7-05C actual hook → reaching Overview', () => {
  it('pending connections cannot flash setup advice or workspace absence', async () => {
    let resolve;
    api.get.mockImplementation(() => new Promise((r) => { resolve = r; }));
    mount(<OverviewView />);
    expect(screen.queryByText(/Connect a channel|Connect Meta|Connect →|A workspace is required/)).not.toBeInTheDocument();
    await act(async () => resolve({ data: { workspaceId: 'ws', connections: [] } }));
    expect(await screen.findByRole('link', { name: 'Connect a channel' })).toHaveAttribute('href', '/app/connections');
  });
  it.each([false, true])('connected/no-campaign retains facts without setup advice, firstRun=%s', async (firstRunFlag) => {
    api.get.mockResolvedValue({ data: { workspaceId: 'ws', connections: [never] } });
    useDismissals.mockReturnValue({ firstRunFlag, dismissed: new Set(), dismiss: vi.fn() });
    mount(<OverviewView />);
    await screen.findByText('Never synced');
    expect(screen.getByText('Latest sync attempt failed')).toBeInTheDocument();
    expect(screen.getByText("A channel is connected, but Lumi doesn't have campaign data to score yet.")).toBeInTheDocument();
    expect(screen.queryByText(/Connect a channel|Connect Meta|Connect →/)).not.toBeInTheDocument();
  });
  it('workspace-null suppresses every reaching connect instruction, including the unchanged strip shortcut', async () => {
    api.get.mockResolvedValue({ data: { workspaceId: null, connections: [] } });
    mount(<OverviewView />);
    await screen.findByText('A workspace is required before channels can be connected.');
    expect(screen.getByText("Lumi doesn't have campaign data to score yet.")).toBeInTheDocument();
    expect(screen.queryByText(/Connect a channel|Connect Meta|Connect →/)).not.toBeInTheDocument();
  });
  it.each(['HTTP', 'contract'])('%s connection failure is not setup cause', async (type) => {
    if (type === 'HTTP') api.get.mockRejectedValue(Object.assign(new Error('Request failed'), { httpStatus: 500 }));
    else api.get.mockResolvedValue({ data: { connections: 'invalid' } });
    mount(<OverviewView />);
    await screen.findByText(/Couldn't load channel status/);
    expect(screen.getByText("Lumi doesn't have campaign data to score yet.")).toBeInTheDocument();
    expect(screen.queryByText(/Connect a channel|Connect Meta|Connect →/)).not.toBeInTheDocument();
  });
  it.each(['BUYER', 'STRATEGIST'])('%s receives setup advice only after resolved empty success', async (role) => {
    useCollabRole.mockReturnValue({ role });
    api.get.mockResolvedValue({ data: { workspaceId: 'ws', connections: [] } });
    mount(<OverviewView />);
    expect(await screen.findByRole('link', { name: 'Connect a channel' })).toHaveAttribute('href', '/app/connections');
  });
  it('CLIENT receives no mutation advice on resolved empty success', async () => {
    useCollabRole.mockReturnValue({ role: 'CLIENT' });
    api.get.mockResolvedValue({ data: { workspaceId: 'ws', connections: [] } });
    mount(<OverviewView />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/lumi/connections'));
    await screen.findByText('No connected channels.');
    expect(screen.queryByText(/Connect a channel|Connect Meta|Connect →/)).not.toBeInTheDocument();
  });
});
describe('P7-05C actual hook → Channels prerequisite', () => {
  it('HTTP failure remains failed read without provider actions', async () => {
    api.get.mockRejectedValue(Object.assign(new Error('Request failed'), { httpStatus: 500 }));
    mount(<ConnectorsView />);
    await screen.findByText(/Couldn't load connections/);
    expect(screen.queryByRole('button', { name: 'connect' })).not.toBeInTheDocument();
  });
  it('workspace-null is prerequisite absence, not failed read or available setup', async () => {
    api.get.mockResolvedValue({ data: { workspaceId: null, connections: [] } });
    mount(<ConnectorsView />);
    await screen.findByText('A workspace is required before channels can be connected.');
    expect(screen.queryByRole('button', { name: 'connect' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load/)).not.toBeInTheDocument();
  });
  it('resolved empty success permits Meta/Google setup', async () => {
    api.get.mockResolvedValue({ data: { workspaceId: 'ws', connections: [] } });
    mount(<ConnectorsView />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'connect' })).toHaveLength(2));
    expect(screen.getAllByText('soon')).toHaveLength(3);
  });
});

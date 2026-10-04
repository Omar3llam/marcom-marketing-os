import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import ConnectorsView from '../ConnectorsView.jsx';
import { useConnections } from '@/hooks/useConnections.js';
import { switchAdAccount } from '../services.js';

vi.mock('@/hooks/useConnections.js', () => ({ useConnections: vi.fn() }));
vi.mock('@/hooks/useProjectId.js', () => ({ useProjectId: () => ({ projectId: 'p1' }) }));
vi.mock('../services.js', () => ({ isConnectable: (p) => ['META', 'GOOGLE'].includes(p), switchAdAccount: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const refetch = vi.fn();
const data = { workspaceId: 'ws', connections: [{ platform: 'META', connected: true, accountId: 'act_1',
  readiness: 'CURRENT', availability: 'OK', completeness: 'COMPLETE',
  availableAccounts: [{ id: 'act_1', name: 'First' }, { id: 'act_2', name: 'Second' }] }] };
beforeEach(() => {
  vi.resetAllMocks();
  useConnections.mockReturnValue({ data, loading: false, error: null, refetch });
});
const mount = () => render(<MemoryRouter><ConnectorsView /></MemoryRouter>);
it.each([null, { results: [{ platform: 'META', ok: false }] }, { results: [{ platform: 'META', ok: true }] }])('successful switch with sync %j confirms only the switch, then refetches', async (sync) => {
  switchAdAccount.mockResolvedValue({ ok: true, sync });
  mount();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'act_2' } });
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Ad account switched.'));
  expect(switchAdAccount).toHaveBeenCalledWith('META', 'act_2');
  expect(refetch).toHaveBeenCalledTimes(1);
  expect(toast.success.mock.invocationCallOrder[0]).toBeLessThan(refetch.mock.invocationCallOrder[0]);
});
it('failed switch preserves failure and does not confirm/refetch', async () => {
  switchAdAccount.mockRejectedValue(new Error('Switch refused'));
  mount();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'act_2' } });
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Switch refused'));
  expect(toast.success).not.toHaveBeenCalled();
  expect(refetch).not.toHaveBeenCalled();
});
it('loading does not show connected or connect affordances', () => {
  useConnections.mockReturnValue({ data: null, loading: true, error: null, refetch });
  mount();
  expect(screen.queryByText('connect')).not.toBeInTheDocument();
  expect(screen.queryByText('Current')).not.toBeInTheDocument();
});
it('failed read stays a failed read, even if previous data exists', () => {
  useConnections.mockReturnValue({ data, loading: false, error: new Error('lookup failed'), refetch });
  mount();
  expect(screen.getByText(/Couldn't load connections/)).toBeInTheDocument();
  expect(screen.queryByText('connect')).not.toBeInTheDocument();
  expect(screen.queryByText('Meta Ads')).not.toBeInTheDocument();
});
it('confirmed workspace absence refuses provider setup without misreporting failure', () => {
  useConnections.mockReturnValue({ data: { workspaceId: null, connections: [] }, loading: false, error: null, refetch });
  mount();
  expect(screen.getByText('A workspace is required before channels can be connected.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'connect' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Couldn't load/)).not.toBeInTheDocument();
});

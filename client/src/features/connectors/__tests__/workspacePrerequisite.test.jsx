import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ConnectorsView from '../ConnectorsView.jsx';
import { useConnections } from '@/hooks/useConnections.js';
vi.mock('@/hooks/useConnections.js', () => ({ useConnections: vi.fn() }));
vi.mock('@/hooks/useProjectId.js', () => ({ useProjectId: () => ({ projectId: 'p1' }) }));
beforeEach(() => vi.resetAllMocks());
const mount = () => render(<MemoryRouter><ConnectorsView /></MemoryRouter>);
it.each([null, '', undefined])('P7-05C workspace %s is a prerequisite absence with no provider actions', (workspaceId) => {
  useConnections.mockReturnValue({ data: { workspaceId, connections: [] }, loading: false, error: null });
  mount();
  expect(screen.getByText('A workspace is required before channels can be connected.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'connect' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Couldn't load/)).not.toBeInTheDocument();
});
it('P7-05C resolved empty workspace retains supported setup and unsupported soon', () => {
  useConnections.mockReturnValue({ data: { workspaceId: 'ws', connections: [] }, loading: false, error: null });
  mount();
  expect(screen.getAllByRole('button', { name: 'connect' })).toHaveLength(2);
  expect(screen.getAllByText('soon')).toHaveLength(3);
});
it('P7-05C an unknown response cannot authorize provider actions', () => {
  useConnections.mockReturnValue({ data: null, loading: false, error: null });
  mount();
  expect(screen.queryByRole('button', { name: 'connect' })).not.toBeInTheDocument();
  expect(screen.queryByText('A workspace is required before channels can be connected.')).not.toBeInTheDocument();
});

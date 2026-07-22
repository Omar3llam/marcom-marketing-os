import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { useConnectionsMock, useProjectIdMock, startConnectMock } = vi.hoisted(() => ({
  useConnectionsMock: vi.fn(),
  useProjectIdMock: vi.fn(),
  startConnectMock: vi.fn(),
}));

vi.mock('@/hooks/useConnections.js', () => ({ useConnections: () => useConnectionsMock() }));
vi.mock('@/hooks/useProjectId.js', () => ({ useProjectId: () => useProjectIdMock() }));
vi.mock('@/pages/Connections.jsx', () => ({ startConnect: (...a) => startConnectMock(...a) }));

import { ConnectStep } from './ConnectStep.jsx';

function setUrl(search) {
  window.history.replaceState({}, '', `/onboarding${search}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  useConnectionsMock.mockReturnValue({ data: { connections: [] } });
  useProjectIdMock.mockReturnValue({ projectId: 'proj_1' });
  setUrl('?step=connect');
});

describe('ConnectStep', () => {
  it('clicking Connect calls startConnect with META + projectId + the onboarding returnTo', () => {
    render(<ConnectStep onConnected={vi.fn()} onSkip={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /connect meta/i }));
    expect(startConnectMock).toHaveBeenCalledWith('META', 'proj_1', '/onboarding?step=connect');
  });

  it('?meta_connected=1 on return → onConnected', () => {
    setUrl('?step=connect&meta_connected=1');
    const onConnected = vi.fn();
    render(<ConnectStep onConnected={onConnected} onSkip={vi.fn()} />);
    expect(onConnected).toHaveBeenCalled();
  });

  it('an already-connected channel → onConnected', () => {
    useConnectionsMock.mockReturnValue({ data: { connections: [{ platform: 'META', connected: true }] } });
    const onConnected = vi.fn();
    render(<ConnectStep onConnected={onConnected} onSkip={vi.fn()} />);
    expect(onConnected).toHaveBeenCalled();
  });

  it('?meta_error → failed state with Try again + skip', () => {
    setUrl('?step=connect&meta_error=denied');
    const onSkip = vi.fn();
    render(<ConnectStep onConnected={vi.fn()} onSkip={onSkip} />);
    expect(screen.getByText(/wasn.t completed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /continue without connecting/i }));
    expect(onSkip).toHaveBeenCalled();
  });

  it('disables Connect until a projectId resolves', () => {
    useProjectIdMock.mockReturnValue({ projectId: null });
    render(<ConnectStep onConnected={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByRole('button', { name: /connect meta/i })).toBeDisabled();
  });
});

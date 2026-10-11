import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StrictMode } from 'react';

const { useConnectionsMock, useProjectIdMock, startConnectMock } = vi.hoisted(() => ({
  useConnectionsMock: vi.fn(),
  useProjectIdMock: vi.fn(),
  startConnectMock: vi.fn(),
}));

vi.mock('@/hooks/useConnections.js', () => ({ useConnections: () => useConnectionsMock() }));
vi.mock('@/hooks/useProjectId.js', () => ({ useProjectId: () => useProjectIdMock() }));
vi.mock('@/features/connectors/startConnect.js', () => ({ startConnect: (...a) => startConnectMock(...a) }));

import { ConnectStep } from './ConnectStep.jsx';

function setUrl(search) {
  window.history.replaceState({}, '', `/onboarding${search}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  useConnectionsMock.mockReturnValue({ data: { workspaceId: 'ws_1', connections: [] }, loading: false, error: null, refetch: vi.fn() });
  useProjectIdMock.mockReturnValue({ projectId: 'proj_1' });
  setUrl('?step=connect');
});

describe('P9-06 — published connection evidence', () => {
  const connected = { workspaceId: 'ws_1', connections: [{ platform: 'META', connected: true, isActive: true }] };
  it.each([
    ['Google only', { workspaceId: 'ws_1', connections: [{ platform: 'GOOGLE', connected: true }] }, false, null],
    ['unresolved workspace', { ...connected, workspaceId: null }, false, null],
    ['blank workspace', { ...connected, workspaceId: ' ' }, false, null],
    ['pending retained data', connected, true, null],
    ['failed retained data', connected, false, new Error('reader failed')],
    ['two active META rows', { ...connected, connections: [...connected.connections, { platform: 'META', connected: true, isActive: true }] }, false, null],
  ])('%s never advances with or without a callback flag', (_name, data, loading, error) => {
    const refetch = vi.fn();
    useConnectionsMock.mockReturnValue({ data, loading, error, refetch });
    const onConnected = vi.fn();
    const view = render(<ConnectStep onConnected={onConnected} onSkip={vi.fn()} />);
    expect(onConnected).not.toHaveBeenCalled();
    view.unmount();
    setUrl('?step=connect&meta_connected=1');
    render(<ConnectStep onConnected={onConnected} onSkip={vi.fn()} />);
    expect(onConnected).not.toHaveBeenCalled();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('callback re-entry refreshes once, ignores its old connected data, then accepts a new settled result', () => {
    setUrl('?step=connect&meta_connected=1');
    const refetch = vi.fn(); const onConnected = vi.fn(); const onSkip = vi.fn();
    useConnectionsMock.mockReturnValue({ data: connected, loading: false, error: null, refetch });
    const view = render(<ConnectStep onConnected={onConnected} onSkip={onSkip} />);
    view.rerender(<ConnectStep onConnected={onConnected} onSkip={onSkip} />);
    expect(onConnected).not.toHaveBeenCalled(); expect(refetch).toHaveBeenCalledTimes(1);
    useConnectionsMock.mockReturnValue({ data: null, loading: true, error: null, refetch });
    view.rerender(<ConnectStep onConnected={onConnected} onSkip={onSkip} />);
    expect(onConnected).not.toHaveBeenCalled();
    useConnectionsMock.mockReturnValue({ data: { ...connected }, loading: false, error: null, refetch });
    view.rerender(<ConnectStep onConnected={onConnected} onSkip={onSkip} />);
    view.rerender(<ConnectStep onConnected={onConnected} onSkip={onSkip} />);
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it('one active META plus inactive historical rows advances once', () => {
    useConnectionsMock.mockReturnValue({ data: { workspaceId: 'ws_1', connections: [
      { platform: 'META', connected: false, isActive: false, connection: 'DISCONNECTED' },
      { platform: 'META', connected: true, isActive: true, connection: 'CONNECTED' },
    ] }, loading: false, error: null });
    const onConnected = vi.fn();
    const view = render(<StrictMode><ConnectStep onConnected={onConnected} onSkip={vi.fn()} /></StrictMode>);
    view.rerender(<StrictMode><ConnectStep onConnected={onConnected} onSkip={vi.fn()} /></StrictMode>);
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['role_forbidden', /workspace strategist/i, false],
    ['authority_unavailable', /confirm.*permission/i, true],
    ['workspace_unavailable', /workspace.*unavailable/i, false],
    ['workspace_mismatch', /workspace.*changed|different workspace/i, false],
    ['project_not_found', /couldn.t find the project/i, false],
    ['incomplete_connection', /usable Meta ad account/i, true],
    ['invalid_state', /session expired/i, true],
    ['denied', /permissions weren.t granted/i, true],
    ['access_denied', /permissions weren.t granted/i, true],
    ['server_error', /wrong on our end/i, true],
    ['unknown_callback', /didn.t complete/i, false],
  ])('%s preserves its cause and honest retry eligibility', (code, copy, retryable) => {
    setUrl('?step=connect&meta_error=' + code + '&meta_connected=1');
    const onConnected = vi.fn(); const onSkip = vi.fn(); const refetch = vi.fn();
    useConnectionsMock.mockReturnValue({ data: connected, loading: false, error: null, refetch });
    render(<ConnectStep onConnected={onConnected} onSkip={onSkip} />);
    expect(screen.getByRole('alert')).toHaveTextContent(copy);
    if (retryable) expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    else expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(onConnected).not.toHaveBeenCalled(); expect(refetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue without connecting' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ httpStatus: 401 }, /sign in again/i, false],
    [{ response: { status: 403 } }, /permission.*start|not permitted/i, false],
    [{ httpStatus: 503 }, /service.*unavailable/i, true],
    [new Error('403 is text, not permission evidence'), /couldn.t reach.*connection service/i, true],
  ])('uses structured start failure evidence: %j', async (error, copy, retryable) => {
    startConnectMock.mockRejectedValue(error);
    const onConnected = vi.fn(); render(<ConnectStep onConnected={onConnected} onSkip={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Meta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(copy);
    expect(Boolean(screen.queryByRole('button', { name: 'Try again' }))).toBe(retryable);
    expect(onConnected).not.toHaveBeenCalled();
  });

  it('an unsuccessful refreshed reader offers a check retry and preserves skip', () => {
    setUrl('?step=connect&meta_connected=1');
    const refetch = vi.fn(); const onConnected = vi.fn(); const onSkip = vi.fn();
    useConnectionsMock.mockReturnValue({ data: connected, loading: false, error: null, refetch });
    const view = render(<ConnectStep onConnected={onConnected} onSkip={onSkip} />);
    useConnectionsMock.mockReturnValue({ data: null, loading: false, error: new Error('read'), refetch });
    view.rerender(<ConnectStep onConnected={onConnected} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry connection check' }));
    expect(refetch).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Continue without connecting' }));
    expect(onSkip).toHaveBeenCalledTimes(1); expect(onConnected).not.toHaveBeenCalled();
  });
});

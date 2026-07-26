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

// startConnect used to be fired and forgotten. Any failure rejected unhandled
// and the button sat on "Redirecting to Meta…" with no error and no way back.
describe('ConnectStep — the connect call can fail', () => {
  it('a throwing startConnect lands on the failed state, never stuck connecting', async () => {
    startConnectMock.mockRejectedValue(new Error('503 META_APP_ID missing'));
    render(<ConnectStep onConnected={vi.fn()} onSkip={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /connect meta/i }));

    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/redirecting to meta/i)).not.toBeInTheDocument();
    expect(screen.getByText(/couldn.t reach Meta/i)).toBeInTheDocument();
  });

  // A response with no oauthUrl is a silent no-op — the redirect never happens.
  it('a resolved-but-no-redirect response also fails honestly', async () => {
    startConnectMock.mockResolvedValue(false);
    render(<ConnectStep onConnected={vi.fn()} onSkip={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /connect meta/i }));

    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  // On the happy path the browser is already navigating away; showing a failure
  // during unload would flash "Connect wasn't completed" on a successful connect.
  it('a redirecting call stays in the connecting state', async () => {
    startConnectMock.mockResolvedValue(true);
    render(<ConnectStep onConnected={vi.fn()} onSkip={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /connect meta/i }));

    expect(await screen.findByText(/redirecting to meta/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });
});

// The callback redirects with a SPECIFIC code. Reporting them all as a
// permissions denial told the user they refused something they never saw.
describe('ConnectStep — the failure message matches the failure', () => {
  const messageFor = (code) => {
    setUrl(`?step=connect&meta_error=${code}`);
    render(<ConnectStep onConnected={vi.fn()} onSkip={vi.fn()} />);
    return screen.getByText(/Try again, or continue/).textContent;
  };

  it.each([
    ['denied', /permissions weren.t granted/i],
    ['access_denied', /permissions weren.t granted/i],
    ['server_error', /wrong on our end/i],
    ['project_not_found', /couldn.t find your workspace/i],
    ['invalid_state', /session expired/i],
  ])('%s → its own message', (code, expected) => {
    expect(messageFor(code)).toMatch(expected);
  });

  it('an unrecognised code falls back without claiming a denial', () => {
    const text = messageFor('some_new_code');
    expect(text).toMatch(/didn.t complete/i);
    expect(text).not.toMatch(/permissions/i);
  });

  it('a server error is never described as the user denying permission', () => {
    expect(messageFor('server_error')).not.toMatch(/permissions/i);
  });
});

// No projectId after the lookup settled: the connect URL can't be built. This
// used to render as a permanently disabled button with no explanation and no
// escape — the skip route lives only on the failed screen.
describe('ConnectStep — projectId lifecycle', () => {
  it('shows "Preparing…" while the project lookup is in flight', () => {
    useProjectIdMock.mockReturnValue({ projectId: null, loading: true, refetch: vi.fn() });
    render(<ConnectStep onConnected={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByText(/preparing/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t prepare/i)).not.toBeInTheDocument();
  });

  it('offers a retry AND a skip once the lookup settled with no project', () => {
    const refetch = vi.fn();
    const onSkip = vi.fn();
    useProjectIdMock.mockReturnValue({ projectId: null, loading: false, refetch });
    render(<ConnectStep onConnected={vi.fn()} onSkip={onSkip} />);

    expect(screen.getByText(/couldn.t prepare the connection/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));
    expect(refetch).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /continue without connecting/i }));
    expect(onSkip).toHaveBeenCalled();
  });

  it('says nothing about preparation once a project resolves', () => {
    useProjectIdMock.mockReturnValue({ projectId: 'proj_1', loading: false, refetch: vi.fn() });
    render(<ConnectStep onConnected={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.queryByText(/couldn.t prepare/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connect meta/i })).toBeEnabled();
  });
});

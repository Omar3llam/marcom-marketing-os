// ============================================================
// OnboardingPage — connect-first orchestrator (PR#266)
// ------------------------------------------------------------
// Step lives in the URL (survives the OAuth redirect). Context is written to the
// backend only after connect+sync — never in NameStep — so OnboardingRoute can't
// bounce the user to /app mid-flow. Step bodies are stubbed; this exercises the
// orchestration (routing + the deferred context write + final navigation).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const navigateSpy = vi.hoisted(() => vi.fn());
const putMock = vi.hoisted(() => vi.fn().mockResolvedValue({ data: { ok: true } }));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigateSpy };
});
vi.mock('@/context/AuthContext.jsx', () => ({ useAuth: () => ({ currentUser: { email: 'a@b.co' } }) }));
vi.mock('@/lib/api.js', () => ({ api: { put: putMock } }));

vi.mock('./steps/NameStep.jsx', () => ({
  // Mirror the real step: the name flows via localStorage (survives OAuth), not props.
  NameStep: ({ onNext }) => (
    <button onClick={() => { localStorage.setItem('marcom:onboarding:name', 'Acme'); onNext('Acme'); }}>
      go-connect
    </button>
  ),
}));
vi.mock('./steps/ConnectStep.jsx', () => ({
  ConnectStep: ({ onConnected, onSkip }) => (
    <div>
      <button onClick={onConnected}>go-sync</button>
      <button onClick={onSkip}>skip</button>
    </div>
  ),
}));
vi.mock('./steps/SyncStep.jsx', () => ({
  SyncStep: ({ onComplete }) => <button onClick={onComplete}>go-ready</button>,
}));
vi.mock('./steps/ReadyStep.jsx', () => ({
  ReadyStep: ({ onEnterApp }) => <button onClick={onEnterApp}>enter-app</button>,
}));

import OnboardingPage from './index.jsx';

function mountAt(search) {
  window.history.replaceState({}, '', `/onboarding${search}`);
  return render(<OnboardingPage />);
}

beforeEach(() => {
  vi.clearAllMocks();
  putMock.mockResolvedValue({ data: { ok: true } });
  localStorage.clear();
});

describe('OnboardingPage — persistence owns advancement', () => {
  const deferred = () => {
    let resolve;
    const promise = new Promise((yes) => { resolve = yes; });
    return { promise, resolve };
  };
  beforeEach(() => localStorage.setItem('marcom:onboarding:name', 'Acme'));

  it('waits for successful persistence and rejects duplicate completion callbacks', async () => {
    const save = deferred(); putMock.mockReturnValue(save.promise);
    mountAt('?step=sync');
    fireEvent.click(screen.getByText('go-ready'));
    fireEvent.click(screen.getByText('go-ready'));
    expect(putMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('enter-app')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/saving/i);
    await act(async () => save.resolve({ data: { ok: true } }));
    expect(screen.getAllByText('enter-app')).toHaveLength(1);
    expect(window.location.search).toBe('?step=ready');
  });

  it('keeps sync on a failed context save, exposes an error, and retries the same name', async () => {
    putMock.mockRejectedValueOnce(new Error('private failure'));
    mountAt('?step=sync');
    fireEvent.click(screen.getByText('go-ready'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t save/i);
    expect(screen.getByText('go-ready')).toBeInTheDocument();
    expect(screen.queryByText('enter-app')).not.toBeInTheDocument();
    expect(localStorage.getItem('marcom:onboarding:name')).toBe('Acme');
    fireEvent.click(screen.getByRole('button', { name: /retry saving/i }));
    await screen.findByText('enter-app');
    expect(putMock).toHaveBeenCalledTimes(2);
    expect(putMock.mock.calls[0][1]).toEqual(putMock.mock.calls[1][1]);
  });

  it('skip failure cannot navigate or clear the name; retry navigates once', async () => {
    putMock.mockRejectedValueOnce(new Error('failed'));
    mountAt('?step=connect');
    fireEvent.click(screen.getByText('skip'));
    await screen.findByRole('alert');
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?step=connect');
    expect(localStorage.getItem('marcom:onboarding:name')).toBe('Acme');
    fireEvent.click(screen.getByRole('button', { name: /retry saving/i }));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('skip'));
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(putMock).toHaveBeenCalledTimes(2);
  });

  it('an unconfirmed resolved save cannot advance', async () => {
    putMock.mockResolvedValue({ data: { ok: false } });
    mountAt('?step=sync'); fireEvent.click(screen.getByText('go-ready'));
    await screen.findByRole('alert');
    expect(screen.queryByText('enter-app')).not.toBeInTheDocument();
  });

  it('a stale save from an unmounted flow cannot advance a newer flow', async () => {
    const earlier = deferred(); const newer = deferred();
    putMock.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(newer.promise);
    const first = mountAt('?step=connect'); fireEvent.click(screen.getByText('skip')); first.unmount();
    mountAt('?step=sync'); fireEvent.click(screen.getByText('go-ready'));
    await act(async () => earlier.resolve({ data: { ok: true } }));
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('enter-app')).not.toBeInTheDocument();
    await act(async () => newer.resolve({ data: { ok: true } }));
    expect(screen.getByText('enter-app')).toBeInTheDocument();
  });

  it('retains the entered name in memory if draft storage disappears before save', async () => {
    mountAt(''); fireEvent.click(screen.getByText('go-connect')); localStorage.clear();
    fireEvent.click(screen.getByText('skip'));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalled());
    expect(putMock.mock.calls[0][1].workspaceName).toBe('Acme');
  });

  it('does not fabricate a default name after a reload loses the draft', async () => {
    localStorage.clear(); mountAt('?step=sync'); fireEvent.click(screen.getByText('go-ready'));
    await screen.findByRole('alert');
    expect(putMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /return to workspace/i }));
    expect(screen.getByText('go-connect')).toBeInTheDocument();
  });
});

describe('OnboardingPage — connect-first flow', () => {
  it('defaults to the name step when no ?step is present', () => {
    mountAt('');
    expect(screen.getByText('go-connect')).toBeInTheDocument();
  });

  it('reads the step from the URL (survives the OAuth redirect)', () => {
    mountAt('?step=sync');
    expect(screen.getByText('go-ready')).toBeInTheDocument();
  });

  it('labels every progress bar and highlights the current step', () => {
    mountAt('?step=sync');
    ['Workspace', 'Connect', 'Analyze', 'Verdict'].forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
    // Emphasis is weight + the darkest text token, not lumi-gold — gold is
    // 1.34:1 on the light surface, i.e. no highlight at all.
    expect(screen.getByText('Analyze').className).toMatch(/text-lumi-text/);
    expect(screen.getByText('Analyze').className).toMatch(/font-semibold/);
    expect(screen.getByText('Verdict').className).not.toMatch(/text-lumi-text\b/);
  });

  it('advances name → connect → sync → ready and never writes context before sync', async () => {
    mountAt('');
    fireEvent.click(screen.getByText('go-connect'));       // name → connect
    expect(putMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('go-sync'));           // connect → sync
    expect(putMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('go-ready'));          // sync done → writes context, → ready
    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    expect(putMock).toHaveBeenCalledWith('/api/campaigns/me/context', expect.objectContaining({
      context: { name: 'Acme' },
      workspaceName: 'Acme',
    }));
    await waitFor(() => expect(screen.getByText('enter-app')).toBeInTheDocument());
  });

  it('final CTA navigates to /app/campaigns', async () => {
    localStorage.setItem('marcom:onboarding:name', 'Acme');
    mountAt('?step=ready');
    fireEvent.click(screen.getByText('enter-app'));
    expect(navigateSpy).toHaveBeenCalledWith('/app/campaigns', { replace: true });
  });

  it('skip writes context and lands on /app/overview', async () => {
    localStorage.setItem('marcom:onboarding:name', 'Acme');
    mountAt('?step=connect');
    fireEvent.click(screen.getByText('skip'));
    await waitFor(() => expect(putMock).toHaveBeenCalled());
    expect(navigateSpy).toHaveBeenCalledWith('/app/overview', { replace: true });
  });
});

// The flow rendered on bg-dark-base — which is colors.text.base (#2B2B2B), a
// TEXT token — while styling its copy with lumi-*, whose text token is also
// #2B2B2B. Every heading was #2B2B2B on #2B2B2B: a 1:1 ratio, i.e. invisible.
// Unit tests can't see colour, so this pins the SURFACE the tokens assume.
describe('OnboardingPage — renders on the app surface', () => {
  it('uses the light page background, never the text token', () => {
    const { container } = mountAt('');
    const page = container.firstChild;
    expect(page.className).toMatch(/bg-lumi-bg/);
    expect(page.className).not.toMatch(/bg-dark-base/);
  });

  it('drops the fixed px-8 gutter on small screens', () => {
    const { container } = mountAt('');
    const column = container.firstChild.firstChild; // the 580px content column
    expect(column.className).toMatch(/max-w-\[580px\]/);
    expect(column.className).toMatch(/sm:px-8/);
    expect(column.className).not.toMatch(/(^|\s)px-8/);
  });
});

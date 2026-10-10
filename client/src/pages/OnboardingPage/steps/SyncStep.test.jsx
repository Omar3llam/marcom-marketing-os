import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { StrictMode } from 'react';

vi.mock('@/lib/api.js', () => ({ api: { post: vi.fn() } }));
import { api } from '@/lib/api.js';
import { SyncStep } from './SyncStep.jsx';
const success = { data: { ok: true, synced: 1, failed: 0, results: [{ platform: 'META', status: 'success' }] } };

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('SyncStep — pending progress truth', () => {
  it('successful results wait for the existing 700ms completion callback without repeating the request', async () => {
    api.post.mockResolvedValue(success);
    const onComplete = vi.fn();
    render(<SyncStep onComplete={onComplete} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('status')).toHaveTextContent('Sync results received.');
    await act(async () => vi.advanceTimersByTimeAsync(699));
    expect(onComplete).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an unresolved request stays static through both elapsed-wait hints without advancing', async () => {
    api.post.mockReturnValue(new Promise(() => {}));
    const onComplete = vi.fn();
    const { container } = render(<SyncStep onComplete={onComplete} />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Syncing your workspace…');
    expect(container.querySelector('.animate-spin, .animate-pulse')).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(screen.getByText('Large accounts may take longer. Waiting for sync results.')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(screen.getByText('Still waiting for sync results. Keep this page open.')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(container.querySelector('.animate-spin, .animate-pulse')).toBeNull();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/api/lumi/connections/sync', { datePreset: 'maximum' });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure', 'partial', 'refusal'])('queued hint callbacks cannot republish waiting copy after %s', async (outcome) => {
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    let resolve; let reject;
    api.post.mockReturnValue(new Promise((yes, no) => { resolve = yes; reject = no; }));
    render(<SyncStep onComplete={vi.fn()} />);
    const oldHints = timeout.mock.calls.filter(([, delay]) => delay === 30_000 || delay === 60_000).map(([callback]) => callback);
    expect(oldHints).toHaveLength(2);
    await act(async () => {
      if (outcome === 'failure') reject(new Error('failed'));
      else if (outcome === 'refusal') reject({ httpStatus: 403 });
      else resolve(outcome === 'success' ? success : { data: { ok: true, synced: 1, results: [{ status: 'success' }, { status: 'error' }] } });
    });
    await act(async () => oldHints.forEach((callback) => callback()));
    expect(screen.queryByText(/large accounts|still waiting/i)).not.toBeInTheDocument();
    if (outcome === 'success') expect(screen.getByRole('status')).toHaveTextContent(/sync results received/i);
    else expect(screen.getByRole('alert')).toBeInTheDocument();
    if (outcome === 'refusal') {
      expect(screen.queryByRole('button', { name: /retry sync/i })).not.toBeInTheDocument();
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it('queued waiting callbacks from a failed attempt cannot alter its retry', async () => {
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    let reject;
    api.post.mockReturnValueOnce(new Promise((_yes, no) => { reject = no; })).mockReturnValue(new Promise(() => {}));
    render(<SyncStep onComplete={vi.fn()} />);
    const oldHints = timeout.mock.calls.filter(([, delay]) => delay === 30_000 || delay === 60_000).map(([callback]) => callback);
    expect(oldHints).toHaveLength(2);
    await act(async () => { reject(new Error('failed')); });
    fireEvent.click(screen.getByRole('button', { name: /retry sync/i }));
    await act(async () => oldHints.forEach((callback) => callback()));
    expect(screen.queryByText(/large accounts|still waiting/i)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/syncing your workspace/i);
  });

  it.each([601, 2001, 4501, 120_000])('an unresolved request at %ims cannot certify backend stages', async (elapsed) => {
    api.post.mockReturnValue(new Promise(() => {}));
    const onComplete = vi.fn();
    const { container } = render(<SyncStep onComplete={onComplete} />);
    await act(async () => vi.advanceTimersByTimeAsync(elapsed));
    expect(container.querySelector('.lucide-circle-check')).toBeNull();
    expect(screen.queryByText(/connected to meta/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/scanning campaigns|calculating signals|building verdicts|preparing results/i)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/syncing your workspace/i);
    expect(container.textContent).not.toMatch(/\d+%|under a minute|sync complete/i);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it.each(['failure', 'partial'])('%s after a long pending request cannot retain completed stage claims', async (outcome) => {
    let resolve; let reject;
    api.post.mockReturnValue(new Promise((yes, no) => { resolve = yes; reject = no; }));
    const onComplete = vi.fn();
    const { container } = render(<SyncStep onComplete={onComplete} />);
    await act(async () => vi.advanceTimersByTimeAsync(65_000));
    await act(async () => {
      if (outcome === 'failure') reject(new Error('failed'));
      else resolve({ data: { ok: true, synced: 1, failed: 1, results: [{ status: 'success' }, { status: 'error' }] } });
    });
    expect(container.querySelector('.lucide-circle-check')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(outcome === 'failure' ? /couldn’t analyze/i : /others failed or were skipped/i);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('retry resets pending presentation without carrying earlier stage completion', async () => {
    api.post.mockRejectedValueOnce(new Error('failed')).mockReturnValue(new Promise(() => {}));
    const onComplete = vi.fn();
    const { container } = render(<SyncStep onComplete={onComplete} />);
    await act(async () => vi.runAllTimersAsync());
    fireEvent.click(screen.getByRole('button', { name: /retry sync/i }));
    await act(async () => vi.advanceTimersByTimeAsync(4501));
    expect(container.querySelector('.lucide-circle-check')).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/syncing your workspace/i);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('pending unmount clears every visual timer and a remount begins pending', async () => {
    api.post.mockReturnValue(new Promise(() => {}));
    const first = render(<SyncStep onComplete={vi.fn()} />);
    await act(async () => vi.advanceTimersByTimeAsync(4501));
    first.unmount();
    expect(vi.getTimerCount()).toBe(0);
    const { container } = render(<SyncStep onComplete={vi.fn()} />);
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(container.querySelector('.lucide-circle-check')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/syncing your workspace/i);
  });
});

describe('SyncStep', () => {
  it.each([
    { httpStatus: 503 }, { response: { status: 500 } }, new Error('offline'),
    { httpStatus: 408 }, { response: { status: 429 } },
  ])('transient failure %j keeps retry without completing', async (err) => {
    api.post.mockRejectedValueOnce(err);
    const onComplete = vi.fn(); render(<SyncStep onComplete={onComplete} />);
    await act(async () => vi.runAllTimersAsync());
    expect(screen.getByRole('button', { name: /retry sync/i })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/retry the sync/i);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it.each([
    [{ httpStatus: 403, code: 'AUTH_ACCESS_DENIED' }, /this seat can’t start a connection sync/i],
    [{ response: { status: 403, data: { error: 'RoleForbidden' } } }, /this seat can’t start a connection sync/i],
    [{ httpStatus: 401 }, /sign in again/i],
    [{ response: { status: 400, data: { error: 'WorkspaceNotFound' } } }, /current workspace setup/i],
  ])('permanent refusal %j stays on step without a blind retry', async (err, copy) => {
    api.post.mockRejectedValueOnce(err);
    const onComplete = vi.fn(); const { container } = render(<SyncStep onComplete={onComplete} />);
    await act(async () => vi.runAllTimersAsync());
    expect(screen.queryByRole('button', { name: /retry sync/i })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(copy);
    expect(container.textContent).not.toMatch(/stay here and retry|RoleForbidden|AUTH_ACCESS_DENIED|WorkspaceNotFound|SyncFailed/);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('auto-triggers the sync POST on mount', () => {
    api.post.mockResolvedValue(success);
    render(<SyncStep onComplete={vi.fn()} />);
    expect(api.post).toHaveBeenCalledWith('/api/lumi/connections/sync', { datePreset: 'maximum' });
  });

  it('calls onComplete after a successful sync', async () => {
    api.post.mockResolvedValue(success);
    const onComplete = vi.fn();
    render(<SyncStep onComplete={onComplete} />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('rejected sync stays on the step and offers retry without completing', async () => {
    api.post.mockRejectedValue(new Error('sync boom'));
    const onComplete = vi.fn();
    render(<SyncStep onComplete={onComplete} />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn’t analyze/i);
    expect(screen.getByRole('button', { name: /retry sync/i })).toBeInTheDocument();
  });

  it('renders neutral activity while awaiting the response', () => {
    api.post.mockResolvedValue(success);
    render(<SyncStep onComplete={vi.fn()} />);
    expect(screen.getByText(/analyzing your account/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/syncing your workspace/i);
  });
});

// Waiting hints report the unresolved request, not backend progress or an ETA.
describe('SyncStep — long-sync messaging', () => {
  const hang = () => { api.post.mockReturnValue(new Promise(() => {})); };

  it('says nothing while the sync is still quick', async () => {
    hang();
    render(<SyncStep onComplete={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(screen.queryByText(/large accounts/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/keep this page open/i)).not.toBeInTheDocument();
  });

  it('after 30s, explains that large accounts take longer', async () => {
    hang();
    render(<SyncStep onComplete={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByText(/large accounts may take longer/i)).toBeInTheDocument();
  });

  it('after 60s, tells the user they can leave the page open', async () => {
    hang();
    render(<SyncStep onComplete={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByText(/still waiting for sync results/i)).toBeInTheDocument();
    expect(screen.queryByText(/large accounts/i)).not.toBeInTheDocument();
  });

  // A sync that finished must not later claim to be slow.
  it('a completed sync never shows the long-sync hints', async () => {
    api.post.mockResolvedValue(success);
    render(<SyncStep onComplete={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    expect(screen.queryByText(/large accounts/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/keep this page open/i)).not.toBeInTheDocument();
  });
});

describe('SyncStep — outcome and lifecycle safety', () => {
  it.each(['success', 'partial'])('retryable failure retracts copy and hints, then recovers to %s exactly once', async (outcome) => {
    let resolve;
    api.post.mockRejectedValueOnce(outcome === 'success' ? { httpStatus: 500 } : new Error('offline'))
      .mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const onComplete = vi.fn(); render(<SyncStep onComplete={onComplete} />);
    await act(async () => vi.runAllTimersAsync());
    const retry = screen.getByRole('button', { name: /retry sync/i });
    fireEvent.click(retry); fireEvent.click(retry);
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/large accounts|still waiting/i)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/syncing your workspace/i);
    await act(async () => { resolve(outcome === 'success' ? success
      : { data: { ok: true, synced: 1, results: [{ status: 'success' }, { status: 'error' }] } }); });
    if (outcome === 'partial') {
      expect(onComplete).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /retry sync/i })).toBeInTheDocument();
      const proceed = screen.getByRole('button', { name: /continue with available/i });
      fireEvent.click(proceed); fireEvent.click(proceed);
    }
    await act(async () => vi.runAllTimersAsync());
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('partial retry issues one additional request and completes from its success', async () => {
    api.post.mockResolvedValueOnce({ data: { ok: true, synced: 1, results: [{ status: 'success' }, { status: 'skipped' }] } })
      .mockResolvedValueOnce(success);
    const onComplete = vi.fn(); render(<SyncStep onComplete={onComplete} />);
    await act(async () => vi.runAllTimersAsync());
    expect(screen.getByRole('button', { name: /continue with available/i })).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /retry sync/i });
    fireEvent.click(retry); fireEvent.click(retry);
    await act(async () => vi.runAllTimersAsync());
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it.each([
    { data: { ok: true, synced: 1 } },
    { data: { ok: true, synced: 1, results: 'invalid' } },
    { data: { ok: false, synced: 1, results: [{ status: 'success' }] } },
    { data: { ok: true, synced: 0, failed: 1, results: [{ status: 'error' }] } },
    { data: { ok: true, synced: 0, failed: 0, results: [{ status: 'skipped' }] } },
    { data: { ok: true, synced: 0, results: [] } },
  ])('a resolved non-success cannot complete: %j', async (response) => {
    api.post.mockResolvedValue(response); const onComplete = vi.fn();
    render(<SyncStep onComplete={onComplete} />);
    await act(async () => vi.runAllTimersAsync());
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry sync/i })).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('retry after failure is guarded against duplicate clicks and completes once', async () => {
    api.post.mockRejectedValueOnce(new Error('failure')).mockResolvedValue(success);
    const onComplete = vi.fn(); render(<SyncStep onComplete={onComplete} />);
    await act(async () => vi.runAllTimersAsync());
    const retry = screen.getByRole('button', { name: /retry sync/i });
    fireEvent.click(retry); fireEvent.click(retry);
    await act(async () => vi.runAllTimersAsync());
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('partial channel success stays explicit until the user continues with available results', async () => {
    api.post.mockResolvedValue({ data: { ok: true, synced: 1, failed: 1, results: [{ status: 'success' }, { status: 'error' }] } });
    const onComplete = vi.fn(); render(<SyncStep onComplete={onComplete} />);
    await act(async () => vi.runAllTimersAsync());
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/others failed or were skipped/i);
    const proceed = screen.getByRole('button', { name: /continue with available/i });
    fireEvent.click(proceed); fireEvent.click(proceed);
    await act(async () => vi.runAllTimersAsync());
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('unmount clears the completion timer', async () => {
    api.post.mockResolvedValue(success); const onComplete = vi.fn();
    const view = render(<SyncStep onComplete={onComplete} />);
    await act(async () => { await Promise.resolve(); });
    view.unmount();
    await act(async () => vi.runAllTimersAsync());
    expect(onComplete).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a late response from an unmounted sync cannot complete a newer instance', async () => {
    let resolveEarlier; let resolveNewer;
    api.post.mockReturnValueOnce(new Promise((yes) => { resolveEarlier = yes; }))
      .mockReturnValueOnce(new Promise((yes) => { resolveNewer = yes; }));
    const earlierDone = vi.fn(); const newerDone = vi.fn();
    const first = render(<SyncStep onComplete={earlierDone} />); first.unmount();
    render(<SyncStep onComplete={newerDone} />);
    await act(async () => { resolveEarlier(success); await vi.runAllTimersAsync(); });
    expect(earlierDone).not.toHaveBeenCalled(); expect(newerDone).not.toHaveBeenCalled();
    await act(async () => { resolveNewer(success); await vi.runAllTimersAsync(); });
    expect(newerDone).toHaveBeenCalledTimes(1);
  });

  it('changing the completion callback does not start a second sync', async () => {
    api.post.mockResolvedValue(success); const previous = vi.fn(); const latest = vi.fn();
    const view = render(<SyncStep onComplete={previous} />);
    await act(async () => { await Promise.resolve(); });
    view.rerender(<SyncStep onComplete={latest} />);
    await act(async () => vi.runAllTimersAsync());
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(previous).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledTimes(1);
  });

  it('StrictMode replay cannot duplicate the sync or complete twice', async () => {
    api.post.mockResolvedValue(success); const onComplete = vi.fn();
    render(<StrictMode><SyncStep onComplete={onComplete} /></StrictMode>);
    await act(async () => vi.runAllTimersAsync());
    expect(api.post).toHaveBeenCalledTimes(1); expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

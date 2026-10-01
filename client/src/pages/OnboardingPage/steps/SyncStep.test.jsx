import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { StrictMode } from 'react';

vi.mock('@/lib/api.js', () => ({ api: { post: vi.fn() } }));
import { api } from '@/lib/api.js';
import { SyncStep } from './SyncStep.jsx';
const success = { data: { ok: true, synced: 1, failed: 0, results: [{ platform: 'META', status: 'success' }] } };

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('SyncStep', () => {
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

  it('renders the progress phases', () => {
    api.post.mockResolvedValue(success);
    render(<SyncStep onComplete={vi.fn()} />);
    expect(screen.getByText(/analyzing your account/i)).toBeInTheDocument();
    expect(screen.getByText(/building verdicts/i)).toBeInTheDocument();
  });
});

// A 'maximum' pull on a large account can outlast the phase list, and the api
// client gives up at 60s. Both lines are about expectations, not progress.
describe('SyncStep — long-sync messaging', () => {
  const hang = () => { api.post.mockReturnValue(new Promise(() => {})); };

  it('says nothing while the sync is still quick', async () => {
    hang();
    render(<SyncStep onComplete={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(screen.queryByText(/large accounts/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/safely leave/i)).not.toBeInTheDocument();
  });

  it('after 30s, explains that large accounts take longer', async () => {
    hang();
    render(<SyncStep onComplete={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByText(/large accounts can take a few minutes/i)).toBeInTheDocument();
  });

  it('after 60s, tells the user they can leave the page open', async () => {
    hang();
    render(<SyncStep onComplete={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByText(/safely leave this page open/i)).toBeInTheDocument();
    expect(screen.queryByText(/large accounts/i)).not.toBeInTheDocument();
  });

  // A sync that finished must not later claim to be slow.
  it('a completed sync never shows the long-sync hints', async () => {
    api.post.mockResolvedValue(success);
    render(<SyncStep onComplete={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    expect(screen.queryByText(/large accounts/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/safely leave/i)).not.toBeInTheDocument();
  });
});

describe('SyncStep — outcome and lifecycle safety', () => {
  it.each([
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

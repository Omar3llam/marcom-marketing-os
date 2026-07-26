import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('@/lib/api.js', () => ({ api: { post: vi.fn() } }));
import { api } from '@/lib/api.js';
import { SyncStep } from './SyncStep.jsx';

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('SyncStep', () => {
  it('auto-triggers the sync POST on mount', () => {
    api.post.mockResolvedValue({ data: { synced: 1 } });
    render(<SyncStep onComplete={vi.fn()} />);
    expect(api.post).toHaveBeenCalledWith('/api/lumi/connections/sync', { datePreset: 'maximum' });
  });

  it('calls onComplete after a successful sync', async () => {
    api.post.mockResolvedValue({ data: { synced: 1 } });
    const onComplete = vi.fn();
    render(<SyncStep onComplete={onComplete} />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(onComplete).toHaveBeenCalled();
  });

  it('calls onComplete even when the sync fails (never traps the user)', async () => {
    api.post.mockRejectedValue(new Error('sync boom'));
    const onComplete = vi.fn();
    render(<SyncStep onComplete={onComplete} />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(onComplete).toHaveBeenCalled();
  });

  it('renders the progress phases', () => {
    api.post.mockResolvedValue({ data: { synced: 0 } });
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
    api.post.mockResolvedValue({ data: { synced: 1 } });
    render(<SyncStep onComplete={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    expect(screen.queryByText(/large accounts/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/safely leave/i)).not.toBeInTheDocument();
  });
});

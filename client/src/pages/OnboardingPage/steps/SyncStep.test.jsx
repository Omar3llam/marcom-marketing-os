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
    expect(screen.getByText(/analyzing your campaigns/i)).toBeInTheDocument();
    expect(screen.getByText(/building verdicts/i)).toBeInTheDocument();
  });
});

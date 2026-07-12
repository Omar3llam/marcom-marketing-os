// ============================================================
// useCopilot — client-owned account Q&A conversation
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCopilot } from './useCopilot.js';
import { api } from '@/lib/api.js';

vi.mock('@/lib/api.js', () => ({ api: { post: vi.fn() } }));

describe('useCopilot', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adds the user message immediately and the answer after the response', async () => {
    api.post.mockResolvedValueOnce({ data: { answer: 'CPA rose on Ramadan Wave.' } });
    const { result } = renderHook(() => useCopilot());

    await act(async () => { await result.current.ask('Why did CPA jump?'); });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({ role: 'user', content: 'Why did CPA jump?' });
    expect(result.current.messages[1]).toMatchObject({ role: 'assistant', content: 'CPA rose on Ramadan Wave.', isError: false });
    expect(result.current.isAsking).toBe(false);
    expect(api.post).toHaveBeenCalledWith('/api/lumi/copilot', { question: 'Why did CPA jump?', history: [] });
  });

  it('sends the prior transcript as history on the next question', async () => {
    api.post.mockResolvedValue({ data: { answer: 'a1' } });
    const { result } = renderHook(() => useCopilot());

    await act(async () => { await result.current.ask('q1'); });
    await act(async () => { await result.current.ask('q2'); });

    expect(api.post.mock.calls[1][1]).toEqual({
      question: 'q2',
      history: [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }],
    });
  });

  it('renders an honest error bubble (never a fabricated answer) on failure', async () => {
    api.post.mockRejectedValueOnce(new Error('500'));
    const { result } = renderHook(() => useCopilot());

    await act(async () => { await result.current.ask('boom'); });

    expect(result.current.messages[1]).toMatchObject({ role: 'assistant', isError: true });
    expect(result.current.messages[1].content).toMatch(/couldn't answer/i);
    expect(result.current.error).toBeTruthy();
  });

  it('ignores empty questions', async () => {
    const { result } = renderHook(() => useCopilot());
    await act(async () => { await result.current.ask('   '); });
    expect(result.current.messages).toHaveLength(0);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('clear() resets the conversation', async () => {
    api.post.mockResolvedValueOnce({ data: { answer: 'a' } });
    const { result } = renderHook(() => useCopilot());
    await act(async () => { await result.current.ask('q'); });
    act(() => { result.current.clear(); });
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });
});

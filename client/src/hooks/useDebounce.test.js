// ============================================================
// useDebounce
// ------------------------------------------------------------
// Fake timers throughout: the point of the hook is *when* it commits, and a
// real 300ms wait per case would make the file slow and flaky at the same time.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebounce } from './useDebounce.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useDebounce', () => {
  // A consumer that fetches on the debounced value must still fetch on mount,
  // rather than showing an empty list for the first delay.
  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('acme', 300));
    expect(result.current).toBe('acme');
  });

  it('does not update before the delay has elapsed', () => {
    const { result, rerender } = renderHook(({ v }) => useDebounce(v, 300), {
      initialProps: { v: 'a' },
    });

    rerender({ v: 'ab' });
    act(() => { vi.advanceTimersByTime(299); });

    expect(result.current).toBe('a');
  });

  it('updates once the delay elapses', () => {
    const { result, rerender } = renderHook(({ v }) => useDebounce(v, 300), {
      initialProps: { v: 'a' },
    });

    rerender({ v: 'ab' });
    act(() => { vi.advanceTimersByTime(300); });

    expect(result.current).toBe('ab');
  });

  // The property that makes it a debounce and not a delay: a burst of
  // keystrokes commits once, with the last value — not once per keystroke.
  it('cancels the pending update on a rapid change', () => {
    const { result, rerender } = renderHook(({ v }) => useDebounce(v, 300), {
      initialProps: { v: 'a' },
    });

    rerender({ v: 'ac' });
    act(() => { vi.advanceTimersByTime(200); });
    rerender({ v: 'acm' });
    act(() => { vi.advanceTimersByTime(200); });
    rerender({ v: 'acme' });

    // 400ms of typing has passed and nothing has committed yet.
    expect(result.current).toBe('a');

    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe('acme');
  });

  it('never emits an intermediate value from a burst', () => {
    const seen = [];
    const { rerender } = renderHook(({ v }) => { seen.push(useDebounce(v, 300)); }, {
      initialProps: { v: '' },
    });

    for (const v of ['a', 'ac', 'acm', 'acme']) {
      rerender({ v });
      act(() => { vi.advanceTimersByTime(50); });
    }
    act(() => { vi.advanceTimersByTime(300); });

    expect(seen).not.toContain('ac');
    expect(seen).not.toContain('acm');
    expect(seen.at(-1)).toBe('acme');
  });

  it('clears its timer on unmount', () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = renderHook(() => useDebounce('a', 300));
    unmount();
    expect(clear).toHaveBeenCalled();
  });
});

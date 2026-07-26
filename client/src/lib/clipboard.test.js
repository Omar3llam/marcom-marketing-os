// ============================================================
// clipboard — always resolves, never lies about the outcome
// ------------------------------------------------------------
// A copy button that reports success when nothing reached the clipboard is the
// failure mode these tests exist to prevent: the marketer pastes stale content
// believing it is the decision. Every path returns an explicit ok flag.
// ============================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
import { copyToClipboard } from './clipboard.js';

const setClipboard = (value) => {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true, writable: true });
};

afterEach(() => {
  setClipboard(undefined);
  delete document.execCommand;
  vi.restoreAllMocks();
});

describe('copyToClipboard', () => {
  it('uses the async Clipboard API when available', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ writeText });

    await expect(copyToClipboard('Verdict: KILL')).resolves.toEqual({ ok: true });
    expect(writeText).toHaveBeenCalledWith('Verdict: KILL');
  });

  it('a rejected write reports the failure instead of claiming success', async () => {
    setClipboard({ writeText: vi.fn(() => Promise.reject(new Error('Permission denied'))) });

    const res = await copyToClipboard('x');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Permission denied');
  });

  // Insecure context (plain-http staging, some embedded webviews): the async API
  // is simply absent, so the legacy path has to carry the copy.
  it('falls back to execCommand when the Clipboard API is unavailable', async () => {
    setClipboard(undefined);
    document.execCommand = vi.fn(() => true);

    await expect(copyToClipboard('fallback text')).resolves.toEqual({ ok: true });
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    // The scratch textarea is always removed, success or not.
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('a failed execCommand reports { ok: false } and still cleans up', async () => {
    setClipboard(undefined);
    document.execCommand = vi.fn(() => false);

    const res = await copyToClipboard('x');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('execCommand failed');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('no clipboard support at all → an honest failure, never a throw', async () => {
    setClipboard(undefined);
    delete document.execCommand;

    const res = await copyToClipboard('x');
    expect(res.ok).toBe(false);
  });
});

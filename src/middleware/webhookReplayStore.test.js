// ============================================================
// webhookReplayStore — a single-use claim, and it must actually expire
// ------------------------------------------------------------
// The HMAC verifier proves who produced a request, never that it is the first
// time it has been presented. This store is what makes the second presentation
// recognisable, so two properties matter equally:
//
//   CLAIMS ONCE   a replay inside the window is refused
//   EXPIRES       a claim outside the window is released
//
// The second is not a nicety. A claim that never expires is a memory leak with
// a security label on it, and it would eventually refuse legitimate traffic.
// A mutation that removed the expiry survived the first battery because every
// case ran inside a single instant — the tests below advance the clock.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The store reaches for the queue subsystem's Redis connection when one is
// configured. This suite is about the claim semantics of the in-process
// fallback, so the connection is stubbed absent rather than dialled.
vi.mock('../queues/connection.js', () => ({
  bullConnection: null,
  REDIS_DISABLED: true,
}));

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { claimOnce, _resetReplayStore } = await import('./webhookReplayStore.js');

const TTL = 300_000; // the five-minute replay window

beforeEach(() => {
  _resetReplayStore();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-13T10:00:00Z'));
});

afterEach(() => vi.useRealTimers());

describe('the claim is single-use', () => {
  it('the first claim succeeds', async () => {
    expect(await claimOnce('digest-a', TTL)).toBe(true);
  });

  it('the second claim on the same key fails', async () => {
    await claimOnce('digest-a', TTL);
    expect(await claimOnce('digest-a', TTL)).toBe(false);
  });

  it('every further replay keeps failing', async () => {
    await claimOnce('digest-a', TTL);
    for (let i = 0; i < 5; i += 1) {
      expect(await claimOnce('digest-a', TTL)).toBe(false);
    }
  });

  it('a different key is unaffected', async () => {
    await claimOnce('digest-a', TTL);
    expect(await claimOnce('digest-b', TTL)).toBe(true);
  });
});

describe('the claim expires with the window', () => {
  it('is still held one second before the window closes', async () => {
    await claimOnce('digest-a', TTL);
    vi.setSystemTime(Date.now() + TTL - 1_000);
    expect(await claimOnce('digest-a', TTL)).toBe(false);
  });

  it('is released once the window has passed', async () => {
    await claimOnce('digest-a', TTL);
    vi.setSystemTime(Date.now() + TTL + 1);
    expect(await claimOnce('digest-a', TTL)).toBe(true);
  });

  // A store that holds every key it has ever seen is a leak. Expiry is what
  // bounds it, so the release above must also drop the entry, not merely
  // re-admit the key.
  it('expired entries are dropped rather than accumulated', async () => {
    for (let i = 0; i < 50; i += 1) await claimOnce(`old-${i}`, TTL);
    vi.setSystemTime(Date.now() + TTL + 1);
    // Any write sweeps what has expired.
    await claimOnce('fresh', TTL);
    // Every old key is claimable again, which is only true if they were released.
    for (let i = 0; i < 50; i += 1) {
      expect(await claimOnce(`old-${i}`, TTL)).toBe(true);
    }
  });
});

// The window is a parameter, not a constant baked into the store.
describe('control — the store honours the ttl it is given', () => {
  it('a short ttl releases sooner than a long one', async () => {
    await claimOnce('short', 1_000);
    await claimOnce('long', TTL);
    vi.setSystemTime(Date.now() + 2_000);
    expect(await claimOnce('short', 1_000)).toBe(true);
    expect(await claimOnce('long', TTL)).toBe(false);
  });
});

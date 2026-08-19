// ============================================================
// R13-D / B3-B (§9) — the legacy Action substrate may not claim success
// ============================================================
// This registry used to return `{ ok: true, result: { stub: true } }` for three
// ad-platform kinds and `{ ok: true, result: { echoed } }` for the default. In
// actionWorker those write EXECUTED_SUCCESS and stamp `executedAt`.
//
// It was not dead code. routes/lumi/rollback.js and routes/lumi/quickaction.js
// both enqueue onto this queue, so a rollback — an operation whose entire
// purpose is undoing a real change on a real ad account — could report that it
// had succeeded while the campaign kept running exactly as before.
//
// The substrate could not be removed (those two routes depend on it), so the
// requirement is that it fails loudly instead. This file is the guard on that.
// ============================================================
import { describe, it, expect, vi } from 'vitest';

// Neither Redis nor a queue is the subject; the registry is.
vi.mock('../queues/connection.js', () => ({
  bullConnection: null,
  QUEUE_PREFIX: 'test',
  REDIS_DISABLED: true,
}));
vi.mock('../queues/index.js', () => ({ ACTION_QUEUE_NAME: 'actions' }));
vi.mock('../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { executors } = await import('./actionWorker.js');

describe('no executor in the legacy substrate may report success', () => {
  it('the registry is not empty — this test would be vacuous otherwise', () => {
    expect(Object.keys(executors).length).toBeGreaterThan(0);
  });

  it.each(Object.keys(executors))('%s fails rather than claiming a mutation', async (kind) => {
    const result = await executors[kind]({ kind });
    // `ok: true` here is what wrote EXECUTED_SUCCESS and stamped executedAt.
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it.each(Object.keys(executors))('%s names itself in the failure', async (kind) => {
    // An operator reading a FAILED action needs to know which executor is
    // missing, not just that something went wrong.
    const { error } = await executors[kind]({ kind });
    expect(error).toContain(kind);
  });

  it('every failure points at the canonical path instead', async () => {
    for (const kind of Object.keys(executors)) {
      const { error } = await executors[kind]({});
      expect(error).toMatch(/execute\/meta/);
    }
  });

  it('none returns a stub result that could be mistaken for a platform reply', async () => {
    for (const kind of Object.keys(executors)) {
      const result = await executors[kind]({});
      expect(result).not.toHaveProperty('result');
      expect(JSON.stringify(result)).not.toMatch(/"stub"\s*:\s*true/);
    }
  });

  it('the three ad-platform kinds are still registered — so the failure is specific', () => {
    // Removing them would make rollback fall through to the generic
    // "Unknown executor" branch, which reads as a typo rather than as an
    // unimplemented mutation.
    for (const kind of ['meta.pause_ad', 'meta.scale_budget', 'google.pause_keyword']) {
      expect(executors).toHaveProperty(kind);
    }
  });

  it('noop no longer echoes a success', async () => {
    // `noop` was the DEFAULT for any payload without a `kind`, so this was the
    // most reachable fake-success path of the four.
    const result = await executors.noop({ anything: true });
    expect(result.ok).toBe(false);
  });
});

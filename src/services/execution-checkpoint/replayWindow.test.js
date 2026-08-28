// ============================================================
// R11 — bounded checkpoint replay  (I70) + scoped resume mark (I64)
// ------------------------------------------------------------
// A PAUSED_FOR_APPROVAL checkpoint was resumable forever. It carries a frozen
// execution graph, so resuming a months-old one replays decisions taken against
// an account that no longer looks like that — and every hour it stays resumable
// is another hour a leaked checkpoint id is worth something.
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows = new Map();

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    executionCheckpoint: {
      updateMany: vi.fn(async ({ where = {}, data }) => {
        const matched = [...rows.values()].filter((r) =>
          (!where.id          || r.id          === where.id) &&
          (!where.workspaceId || r.workspaceId === where.workspaceId));
        for (const r of matched) Object.assign(r, data);
        return { count: matched.length };
      }),
      findFirst: vi.fn(async ({ where = {} }) =>
        [...rows.values()].find((r) =>
          (!where.id          || r.id          === where.id) &&
          (!where.workspaceId || r.workspaceId === where.workspaceId)) ?? null),
      create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), count: vi.fn(),
    },
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  isCheckpointReplayable,
  markCheckpointResumed,
  CHECKPOINT_REPLAY_WINDOW_MS,
  CheckpointExpiredError,
} from './index.js';

const WS_MINE    = 'ws-mine';
const WS_FOREIGN = 'ws-foreign';
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => { rows.clear(); vi.clearAllMocks(); });

describe('isCheckpointReplayable (I70)', () => {
  it('accepts a checkpoint created just now', () => {
    expect(isCheckpointReplayable({ createdAt: new Date() })).toBe(true);
  });

  // ── B5-01N · the boundary is evaluated against ONE reference ───────────────
  // This read the wall clock twice — once to build `createdAt`, once to supply
  // `now` — and the predicate is `now - createdAt <= WINDOW`. Substituting
  // createdAt = T0 - WINDOW gives `WINDOW + (T1 - T0) <= WINDOW`, so the test
  // passed only when both reads landed on the same millisecond: measured at 188
  // failures in 2,000,000 trials (~1 run in 10,600) on this machine. The
  // boundary was never flaky; the test was asking two clocks the same question.
  it('accepts one exactly at the edge of the window', () => {
    const now = Date.now();
    const at = new Date(now - CHECKPOINT_REPLAY_WINDOW_MS);
    expect(isCheckpointReplayable({ createdAt: at }, now)).toBe(true);
  });

  // The adjacent invalid state, so the edge above cannot be satisfied by moving
  // the boundary rather than by honouring it. Inclusive means inclusive: one
  // millisecond past the window is already out.
  it('REFUSES one a single millisecond past the edge', () => {
    const now = Date.now();
    const at = new Date(now - CHECKPOINT_REPLAY_WINDOW_MS - 1);
    expect(isCheckpointReplayable({ createdAt: at }, now)).toBe(false);
  });

  // The positive control for the two tests above. The boundary is a pure
  // function of two explicit inputs, so the same question must get the same
  // answer every time it is asked. Reintroducing an independent clock read for
  // either input puts a tick between them; at the rate measured above this loop
  // straddles one within the first few thousand iterations.
  it('answers the boundary identically every time it is asked', () => {
    const answers = new Set();
    for (let i = 0; i < 200_000; i += 1) {
      const now = Date.now();
      answers.add(isCheckpointReplayable({ createdAt: new Date(now - CHECKPOINT_REPLAY_WINDOW_MS) }, now));
    }
    expect([...answers]).toEqual([true]);
  });

  // ── NC-H8 · the control ────────────────────────────────────
  it('REFUSES one past the window', () => {
    const at = new Date(Date.now() - CHECKPOINT_REPLAY_WINDOW_MS - 1000);
    expect(isCheckpointReplayable({ createdAt: at })).toBe(false);
  });

  it('REFUSES a checkpoint far outside the window', () => {
    expect(isCheckpointReplayable({ createdAt: new Date(Date.now() - 400 * DAY) })).toBe(false);
  });

  it('REFUSES a checkpoint with no creation time rather than assuming it is fresh', () => {
    // Unknown age is not young. Defaulting the other way would make a missing
    // column an unbounded replay window.
    expect(isCheckpointReplayable({})).toBe(false);
    expect(isCheckpointReplayable(null)).toBe(false);
  });

  it('exposes a CheckpointExpiredError distinct from "not found"', () => {
    const err = new CheckpointExpiredError('cp1');
    expect(err.name).toBe('CheckpointExpiredError');
    expect(err.statusCode).toBe(409);
  });
});

describe('markCheckpointResumed is workspace-scoped (I64)', () => {
  it('marks a checkpoint the caller owns', async () => {
    rows.set('cp1', { id: 'cp1', workspaceId: WS_MINE, executionId: 'e1', status: 'PAUSED_FOR_APPROVAL', resumedAt: null });

    const out = await markCheckpointResumed('cp1', WS_MINE);

    expect(out.status).toBe('RESUMED');
    expect(rows.get('cp1').resumedAt).toBeInstanceOf(Date);
  });

  // ── NC-B10 · the control ───────────────────────────────────
  it('REFUSES a foreign checkpoint unaided, and writes nothing', async () => {
    rows.set('cp2', { id: 'cp2', workspaceId: WS_FOREIGN, executionId: 'e2', status: 'PAUSED_FOR_APPROVAL', resumedAt: null });

    await expect(markCheckpointResumed('cp2', WS_MINE)).rejects.toThrow(/not found in workspace/);
    expect(rows.get('cp2').resumedAt).toBeNull();
    expect(rows.get('cp2').status).toBe('PAUSED_FOR_APPROVAL');
  });

  it('REFUSES when no workspace is supplied — never falls back to unscoped', async () => {
    rows.set('cp3', { id: 'cp3', workspaceId: WS_MINE, executionId: 'e3', status: 'PAUSED_FOR_APPROVAL', resumedAt: null });
    await expect(markCheckpointResumed('cp3')).rejects.toThrow(/workspaceId required/);
    expect(rows.get('cp3').resumedAt).toBeNull();
  });
});

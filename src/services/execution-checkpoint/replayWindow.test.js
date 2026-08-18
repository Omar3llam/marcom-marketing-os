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

  it('accepts one at the edge of the window', () => {
    const at = new Date(Date.now() - CHECKPOINT_REPLAY_WINDOW_MS);
    expect(isCheckpointReplayable(at ? { createdAt: at } : null, Date.now())).toBe(true);
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

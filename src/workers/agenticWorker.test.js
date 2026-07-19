// ============================================================
// agenticWorker — cron opt-in switch (AGENTIC_CRON_ENABLED)
// ------------------------------------------------------------
// The scheduled sweep is OPT-IN: it runs ONLY when AGENTIC_CRON_ENABLED=true.
// The BullMQ Worker is mocked; the tests pin the scheduling decision:
//   1. Default (unset) → NOT scheduled, AND any previously-registered Redis
//      repeat is actively removed (repeatables persist across boots — skipping
//      the re-add alone would leave an old registration firing 24/7).
//   2. "true" → the repeat is scheduled.
//   3. Any other value ("false"/garbage) → NOT scheduled + repeat removed
//      (only the literal "true" enables).
// Env is read lazily inside startAgenticWorker, so each test flips it per call
// (no vi.resetModules — it segfaults the forks pool).
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('bullmq', () => ({
  Worker: vi.fn(function MockWorker() {
    this.on = vi.fn();
    this.close = vi.fn();
  }),
}));

vi.mock('../queues/connection.js', () => ({
  bullConnection: null,
  QUEUE_PREFIX:   'lumi',
  REDIS_DISABLED: true,
}));

vi.mock('../queues/index.js', () => ({
  AGENTIC_QUEUE_NAME:     'agentic',
  scheduleAgenticSweep:   vi.fn(() => Promise.resolve()),
  unscheduleAgenticSweep: vi.fn(() => Promise.resolve(1)),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: { workspace: { findMany: vi.fn() } },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { scheduleAgenticSweep, unscheduleAgenticSweep } from '../queues/index.js';
import { startAgenticWorker } from './agenticWorker.js';

const ORIGINAL = process.env.AGENTIC_CRON_ENABLED;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AGENTIC_CRON_ENABLED;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.AGENTIC_CRON_ENABLED;
  else process.env.AGENTIC_CRON_ENABLED = ORIGINAL;
});

describe('startAgenticWorker — cron opt-in switch', () => {
  it('does NOT schedule by default (env unset) and removes any persisted repeat', () => {
    startAgenticWorker();
    expect(scheduleAgenticSweep).not.toHaveBeenCalled();
    expect(unscheduleAgenticSweep).toHaveBeenCalledTimes(1);
  });

  it('AGENTIC_CRON_ENABLED=true → schedules the sweep repeat', () => {
    process.env.AGENTIC_CRON_ENABLED = 'true';
    startAgenticWorker();
    expect(scheduleAgenticSweep).toHaveBeenCalledTimes(1);
    expect(unscheduleAgenticSweep).not.toHaveBeenCalled();
  });

  it('only the literal "true" enables — "false" (or anything else) stays off + removes the repeat', () => {
    process.env.AGENTIC_CRON_ENABLED = 'false';
    startAgenticWorker();
    expect(scheduleAgenticSweep).not.toHaveBeenCalled();
    expect(unscheduleAgenticSweep).toHaveBeenCalledTimes(1);
  });
});

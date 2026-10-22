// ============================================================
// Maintenance worker + the ai_usage_logs retention schedule
// ------------------------------------------------------------
// This is the one cron in the system with NO enable flag. Everything else here
// is opt-in because it spends; retention only deletes, and an opt-in retention
// sweep is one nobody turns on — which is the unbounded growth it exists to
// prevent. These tests pin the two properties that make always-on safe:
//
//   1. re-registering REPLACES the previous repeat rather than running both
//      (BullMQ repeatables persist in Redis keyed by pattern, so a changed
//      AIUSAGE_CLEANUP_CRON would otherwise leave the old schedule firing)
//   2. a failed sweep is surfaced, never swallowed — a sweep that silently did
//      nothing is a table growing forever while the logs claim it was cleaned
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';

const cleanAiUsageLogs = vi.hoisted(() => vi.fn());
const connection = vi.hoisted(() => ({ status: 'ready' }));
const maintenanceQueue = vi.hoisted(() => ({
  add: vi.fn(),
  getRepeatableJobs: vi.fn(),
  removeRepeatableByKey: vi.fn(),
}));

vi.mock('../lib/aiUsage.js', () => ({ cleanAiUsageLogs, recordAiUsage: vi.fn() }));
vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// Mocked at the bullmq level, NOT by replacing the queues/index.js export:
// scheduleAiUsageCleanup closes over its own module-scope `maintenanceQueue`
// binding, so re-exporting a stub from a partial module mock would leave the
// real (null) queue in the function under test. Stubbing the Queue class means
// the binding queues/index.js constructs IS the stub.
vi.mock('bullmq', () => ({
  Worker: class {},
  Queue: class {
    constructor(name) { this.name = name; }
    on() { return this; }
    async waitUntilReady() {}
    async close() {}
    add(...args) { return maintenanceQueue.add(...args); }
    getRepeatableJobs(...args) { return maintenanceQueue.getRepeatableJobs(...args); }
    removeRepeatableByKey(...args) { return maintenanceQueue.removeRepeatableByKey(...args); }
  },
}));
// REDIS_DISABLED must be false or every queue is null and the scheduler throws.
vi.mock('../queues/connection.js', () => ({
  bullConnection: connection, QUEUE_PREFIX: 'test', REDIS_DISABLED: false,
  verifyRedisReadiness: async () => ({ connection, evictionPolicy: 'noeviction', workerAdmission: 'NOT_QUALIFIED' }),
  closeRedisConnection: vi.fn(),
}));

import { logger } from '../utils/logger.js';
import { runMaintenanceJob } from './maintenanceWorker.js';
import { scheduleAiUsageCleanup, AI_USAGE_CLEANUP_JOB, initializeQueues } from '../queues/index.js';

// Explicit producer activation replaces the former import-time Queue creation.
beforeAll(async () => { await initializeQueues(); });

const added = () => maintenanceQueue.add.mock.calls.at(-1);

beforeEach(() => {
  vi.clearAllMocks();
  cleanAiUsageLogs.mockResolvedValue(0);
  maintenanceQueue.getRepeatableJobs.mockResolvedValue([]);
  maintenanceQueue.add.mockResolvedValue({});
});
afterEach(() => { delete process.env.AIUSAGE_CLEANUP_CRON; });

describe('scheduleAiUsageCleanup', () => {
  it('registers a daily 03:00 repeat by default', async () => {
    await scheduleAiUsageCleanup();

    const [name, data, opts] = added();
    expect(name).toBe(AI_USAGE_CLEANUP_JOB);
    expect(data).toEqual({});
    expect(opts).toMatchObject({ jobId: AI_USAGE_CLEANUP_JOB, repeat: { pattern: '0 3 * * *' } });
  });

  it('honours AIUSAGE_CLEANUP_CRON', async () => {
    process.env.AIUSAGE_CLEANUP_CRON = '30 4 * * 0';
    await scheduleAiUsageCleanup();

    expect(added()[2].repeat.pattern).toBe('30 4 * * 0');
  });

  // The hazard the agentic/narrative workers carry an unschedule helper for.
  // Without an enable flag, re-registration is what prevents a stale schedule.
  it('removes the previous registration before adding', async () => {
    maintenanceQueue.getRepeatableJobs.mockResolvedValue([
      { id: AI_USAGE_CLEANUP_JOB, key: 'maintenance:ai-usage-cleanup:OLD-PATTERN' },
    ]);

    await scheduleAiUsageCleanup();

    expect(maintenanceQueue.removeRepeatableByKey).toHaveBeenCalledWith(
      'maintenance:ai-usage-cleanup:OLD-PATTERN',
    );
    // Order matters: removing AFTER adding would delete the new registration.
    const removeOrder = maintenanceQueue.removeRepeatableByKey.mock.invocationCallOrder[0];
    const addOrder = maintenanceQueue.add.mock.invocationCallOrder[0];
    expect(removeOrder).toBeLessThan(addOrder);
  });

  it('leaves other jobs on the queue alone', async () => {
    maintenanceQueue.getRepeatableJobs.mockResolvedValue([
      { id: 'some-other-sweep', key: 'maintenance:other:KEY' },
    ]);

    await scheduleAiUsageCleanup();

    expect(maintenanceQueue.removeRepeatableByKey).not.toHaveBeenCalled();
    expect(maintenanceQueue.add).toHaveBeenCalled();
  });

  it('adds exactly one repeat', async () => {
    await scheduleAiUsageCleanup();
    expect(maintenanceQueue.add).toHaveBeenCalledTimes(1);
  });
});

describe('runMaintenanceJob', () => {
  it('runs the retention sweep and reports what it deleted', async () => {
    cleanAiUsageLogs.mockResolvedValue(4_212);

    await expect(runMaintenanceJob({ name: AI_USAGE_CLEANUP_JOB })).resolves.toEqual({
      job: AI_USAGE_CLEANUP_JOB,
      deleted: 4_212,
    });
    expect(cleanAiUsageLogs).toHaveBeenCalledTimes(1);
  });

  it('reports 0 honestly when there was nothing to delete', async () => {
    cleanAiUsageLogs.mockResolvedValue(0);
    await expect(runMaintenanceJob({ name: AI_USAGE_CLEANUP_JOB })).resolves.toMatchObject({ deleted: 0 });
  });

  // Deliberately NOT best-effort, unlike the metering write it cleans up after.
  it('lets a failed sweep fail the job instead of swallowing it', async () => {
    cleanAiUsageLogs.mockRejectedValue(new Error('deadlock detected'));

    await expect(runMaintenanceJob({ name: AI_USAGE_CLEANUP_JOB })).rejects.toThrow('deadlock detected');
  });

  // A maintenance queue that quietly no-ops is indistinguishable from one that
  // is working.
  it('reports an unknown job name rather than claiming success', async () => {
    const res = await runMaintenanceJob({ name: 'not-a-real-job' });

    expect(res).toMatchObject({ job: 'not-a-real-job', skipped: true });
    expect(cleanAiUsageLogs).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('survives a job with no name', async () => {
    await expect(runMaintenanceJob({})).resolves.toMatchObject({ job: null, skipped: true });
    await expect(runMaintenanceJob(undefined)).resolves.toMatchObject({ skipped: true });
  });
});

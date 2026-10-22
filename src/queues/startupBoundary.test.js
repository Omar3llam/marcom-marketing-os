import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  clients: [], queues: [], events: [], policy: ['maxmemory-policy', 'noeviction'],
  connectError: null, configError: null, holdConnect: null, holdQueue: null,
  starts: Array.from({ length: 5 }, () => vi.fn(() => ({ close: vi.fn() }))),
}));
vi.mock('ioredis', () => ({ default: class {
  constructor(_url, options) {
    this.options = options;
    this.status = 'wait'; this.handlers = {};
    this.on = vi.fn((name, cb) => { this.handlers[name] = cb; return this; });
    this.connect = vi.fn(async () => {
      f.events.push('connect');
      if (f.connectError) throw f.connectError;
      if (f.holdConnect) await f.holdConnect;
      this.status = 'ready';
    });
    this.config = vi.fn(async (...args) => {
      f.events.push(['config', ...args]);
      if (f.configError) throw f.configError;
      return f.policy;
    });
    this.disconnect = vi.fn(() => { this.status = 'end'; this.handlers.close?.(); });
    f.clients.push(this);
  }
} }));
vi.mock('bullmq', () => ({
  Queue: class {
    constructor(name, options) {
      this.name = name; this.options = options; f.queues.push(this);
      this.add = vi.fn(); this.close = vi.fn(async () => {});
      this.waitUntilReady = vi.fn(async () => { if (f.holdQueue) await f.holdQueue; });
      this.on = vi.fn(() => this);
    }
  },
}));
vi.mock('../utils/logger.js', () => ({ logger: {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(),
} }));
vi.mock('../workers/executionWorker.js', () => ({ startExecutionWorker: f.starts[0] }));
vi.mock('../workers/syncWorker.js', () => ({ startSyncWorker: f.starts[1] }));
vi.mock('../workers/agenticWorker.js', () => ({ startAgenticWorker: f.starts[2] }));
vi.mock('../workers/narrativeWorker.js', () => ({ startNarrativeWorker: f.starts[3] }));
vi.mock('../workers/maintenanceWorker.js', () => ({ startMaintenanceWorker: f.starts[4] }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('REDIS_URL', 'redis://fixture-user:fixture-secret@127.0.0.1:6399/7');
  f.clients = []; f.queues = []; f.events = [];
  f.policy = ['maxmemory-policy', 'noeviction'];
  f.connectError = null; f.configError = null; f.holdConnect = null; f.holdQueue = null;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('Redis import boundary', () => {
  it('imports the connection without connecting or executing CONFIG', async () => {
    await import('./connection.js');
    expect(f.events).toEqual([]);
  });
  it('imports all queue exports without constructing queues or adding jobs', async () => {
    const q = await import('./index.js');
    expect(f.events).toEqual([]); expect(f.queues).toEqual([]);
    expect(q.executionQueue).toBeNull(); expect(q.maintenanceQueue).toBeNull();
  });
  it('imports the actual Worker entrypoint without consumers or schedules', async () => {
    await import('../workers/index.js');
    expect(f.events).toEqual([]); expect(f.queues).toEqual([]);
    for (const start of f.starts) expect(start).not.toHaveBeenCalled();
  });
  it('imports API Redis consumers without I/O or queue construction', async () => {
    await import('../middleware/rateLimitStore.js');
    await import('../middleware/webhookReplayStore.js');
    await import('../routes/admin/status.js');
    expect(f.events).toEqual([]); expect(f.queues).toEqual([]);
  });
});

describe('explicit Redis readiness is necessary, never Worker authority', () => {
  it('awaits connect and binds the verified profile to the actual client', async () => {
    let release;
    f.holdConnect = new Promise(resolve => { release = resolve; });
    const c = await import('./connection.js');
    const pending = c.verifyRedisReadiness();
    expect(f.events).toEqual(['connect']); expect(f.queues).toEqual([]);
    release();
    const profile = await pending;
    expect(profile.connection).toBe(c.bullConnection);
    // A global command timeout would also affect BullMQ's blocking commands.
    expect(profile.connection.options).not.toHaveProperty('commandTimeout');
    expect(profile).toMatchObject({ evictionPolicy: 'noeviction', workerAdmission: 'NOT_QUALIFIED' });
    expect(f.events).toEqual(['connect', ['config', 'GET', 'maxmemory-policy']]);
  });
  it.each([undefined, null, [], ['maxmemory-policy'], ['maxmemory-policy', 'allkeys-lru'], ['wrong-key', 'noeviction'], ['maxmemory-policy', 'noeviction', 'extra']])(
    'refuses unknown/unsafe policy %j before queue activation', async policy => {
      f.policy = policy;
      const q = await import('./index.js');
      await expect(q.initializeQueues()).rejects.toMatchObject({ code: 'REDIS_POLICY_UNQUALIFIED' });
      expect(f.queues).toEqual([]); expect(q.executionQueue).toBeNull();
      expect(f.clients[0].disconnect).toHaveBeenCalled();
      for (const start of f.starts) expect(start).not.toHaveBeenCalled();
    },
  );
  it.each(['connectError', 'configError'])('sanitizes %s and closes the connection', async field => {
    f[field] = new Error('redis://fixture-user:fixture-secret@private.invalid');
    const c = await import('./connection.js');
    await expect(c.verifyRedisReadiness()).rejects.toMatchObject({ code: 'REDIS_READINESS_FAILED' });
    expect(f.clients[0].disconnect).toHaveBeenCalled();
    const { logger } = await import('../utils/logger.js');
    expect(JSON.stringify([logger.warn.mock.calls, logger.error.mock.calls])).not.toContain('fixture-secret');
  });
  it.each(['', 'redis://127.0.0.1:6379'])('refuses missing/disabled production Redis %j', async url => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('REDIS_URL', url);
    const w = await import('../workers/index.js');
    await expect(w.startWorkerProcess()).rejects.toMatchObject({ code: 'REDIS_UNAVAILABLE' });
    expect(f.events).toEqual([]); expect(f.queues).toEqual([]);
    for (const start of f.starts) expect(start).not.toHaveBeenCalled();
  });
  it('refuses Worker activation even with a verified noeviction profile', async () => {
    const w = await import('../workers/index.js');
    await expect(w.startWorkerProcess()).rejects.toMatchObject({ code: 'WORKER_ADMISSION_UNQUALIFIED' });
    expect(f.events).toContainEqual(['config', 'GET', 'maxmemory-policy']);
    expect(f.queues).toEqual([]);
    for (const start of f.starts) expect(start).not.toHaveBeenCalled();
  });
  it('times out without a late CONFIG command after connect settles', async () => {
    const c = await import('./connection.js');
    vi.useFakeTimers();
    let release;
    f.holdConnect = new Promise(resolve => { release = resolve; });
    const assertion = expect(c.verifyRedisReadiness()).rejects.toMatchObject({ code: 'REDIS_READINESS_FAILED' });
    await vi.advanceTimersByTimeAsync(5001);
    await assertion;
    release();
    await Promise.resolve(); await Promise.resolve();
    expect(f.clients[0].config).not.toHaveBeenCalled();
    expect(f.clients[0].disconnect).toHaveBeenCalled();
  });
  it('coalesces concurrent initializers without duplicate queues or CONFIG calls', async () => {
    const q = await import('./index.js');
    await Promise.all([q.initializeQueues(), q.initializeQueues()]);
    expect(f.queues).toHaveLength(6);
    expect(f.clients[0].config).toHaveBeenCalledTimes(1);
  });
  it('bounds queue readiness, closes partial queues and publishes no handles on failure', async () => {
    const q = await import('./index.js');
    vi.useFakeTimers();
    f.holdQueue = new Promise(() => {});
    const assertion = expect(q.initializeQueues()).rejects.toThrow('QUEUE_INITIALIZATION_FAILED');
    await vi.advanceTimersByTimeAsync(5001);
    await assertion;
    expect(q.executionQueue).toBeNull();
    expect(f.clients[0].disconnect).toHaveBeenCalled();
    for (const queue of f.queues) expect(queue.close).toHaveBeenCalled();
  });
  it('refuses enqueueing and scheduling before explicit initialization', async () => {
    const q = await import('./index.js');
    await expect(q.enqueueExecution({})).rejects.toThrow('unavailable');
    await expect(q.scheduleCampaignSync()).rejects.toThrow('unavailable');
    expect(f.events).toEqual([]); expect(f.queues).toEqual([]);
  });
  it('activates the original six producer queues only through the awaited initializer', async () => {
    const q = await import('./index.js');
    await q.initializeQueues();
    expect(f.queues.map(x => x.name)).toEqual(['observer', 'campaign-sync', 'executions', 'agentic', 'narrative', 'maintenance']);
    for (const queue of f.queues) {
      expect(queue.options.connection).toBe(f.clients[0]);
      expect(queue.options.defaultJobOptions).toMatchObject({ attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
      expect(queue.add).not.toHaveBeenCalled();
    }
    await q.enqueueExecution({ executionId: 'isolated-job', workspaceId: 'w', userId: 'u', actionType: 'PAUSE', targetId: 't' });
    expect(q.executionQueue.add).toHaveBeenCalledWith('execute', expect.any(Object), expect.objectContaining({ jobId: 'isolated-job' }));
    await q.closeQueues();
    expect(q.executionQueue).toBeNull();
    for (const queue of f.queues) expect(queue.close).toHaveBeenCalled();
  });
});

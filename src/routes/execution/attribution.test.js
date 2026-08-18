// ============================================================
// R10 · Phase A — attribution at the request boundary
// ------------------------------------------------------------
// POST /api/execute/meta is where a Decision id becomes a durable column on a
// real platform mutation. Two things must be true here and are asserted below:
// the id is proven to belong to the caller's workspace BEFORE the row exists,
// and an id that cannot be proven refuses the execution rather than quietly
// executing it unattributed.
//
// The second is the load-bearing one. Downgrading an unresolvable id to null
// would produce exactly the pre-R10 state — a real Meta write with no link back
// to the call — while looking like a success to the operator.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import executionRouter from './index.js';

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    // R11 (I61): requireCollabRole falls back to the DB when req.collabRole is
    // unset, and now FAILS CLOSED when that read throws. A mock without a
    // `user` model makes every gated route 503 — which is the gate working.
    user: { findUnique: vi.fn().mockResolvedValue({ collabRole: 'STRATEGIST' }) },
    executionRequest: {
      findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(),
      create: vi.fn(), update: vi.fn(),
    },
    executionTransition: { findMany: vi.fn() },
    auditLog: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    decision: { findFirst: vi.fn() },
  },
}));

vi.mock('../../services/execution/ExecutionLifecycleService.js', () => ({
  lifecycleService: { getExecutionState: vi.fn(), transition: vi.fn() },
}));

vi.mock('../../middleware/firebaseAuth.js', () => ({
  firebaseAuthMiddleware: (req, res, next) => {
    req.user = { uid: 'test-user-123' };
    req.workspaceId = 'test-workspace-456';
    req.userId = 'test-user-123';
    next();
  },
}));

vi.mock('../../middleware/contextGuard.js', () => ({ contextGuard: (req, res, next) => next() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../events.js', () => ({ broadcastWorkspaceEvent: vi.fn() }));
vi.mock('../../queues/index.js', () => ({
  executionQueue:   { getFailedCount: vi.fn(), count: vi.fn().mockResolvedValue(0) },
  enqueueExecution: vi.fn(),
}));
vi.mock('../../services/execution/workerHealth.js', () => ({
  getWorkerHeartbeats: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../services/metaExecutionService.js', () => ({ executeMetaAction: vi.fn() }));

import { prisma } from '../../lib/prisma.js';
import { lifecycleService } from '../../services/execution/ExecutionLifecycleService.js';
import { firebaseAuthMiddleware } from '../../middleware/firebaseAuth.js';

const WS = 'test-workspace-456';
const DECISION_ID = '33333333-3333-3333-3333-333333333333';

const body = (extra = {}) => ({
  actionType: 'PAUSE_CAMPAIGN',
  targetId: '120200000000001',
  targetType: 'campaign',
  idempotencyKey: `key-${Math.random()}`,
  ...extra,
});

describe('R10 · POST /api/execute/meta — decision attribution (I55)', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.executionRequest.findUnique.mockResolvedValue(null); // no idempotent replay
    prisma.executionRequest.create.mockResolvedValue({
      id: 'exec-1', workspaceId: WS, version: 0, correlationId: 'c-1',
    });
    lifecycleService.transition.mockResolvedValue({ id: 'exec-1', status: 'QUEUED', version: 1 });
    prisma.auditLog.create.mockResolvedValue({});
    app = express();
    app.use(express.json());
    app.use(firebaseAuthMiddleware);
    app.use('/api/execute', executionRouter);
  });

  it('persists decisionId on the ExecutionRequest when it resolves', async () => {
    prisma.decision.findFirst.mockResolvedValue({ id: DECISION_ID });

    await request(app).post('/api/execute/meta').send(body({ decisionId: DECISION_ID })).expect(202);

    expect(prisma.executionRequest.create.mock.calls[0][0].data)
      .toHaveProperty('decisionId', DECISION_ID);
  });

  // The scope proof. The lookup must carry workspaceId; a findFirst on the id
  // alone would resolve another account's decision and attribute this
  // workspace's Meta mutation to it.
  it('proves workspace ownership in the lookup, before the row is created', async () => {
    prisma.decision.findFirst.mockResolvedValue({ id: DECISION_ID });

    await request(app).post('/api/execute/meta').send(body({ decisionId: DECISION_ID })).expect(202);

    expect(prisma.decision.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: DECISION_ID, workspaceId: WS } }),
    );
    // Ordering matters: a create that happened first would leave an attributed
    // row behind even when the check later refuses.
    const lookupOrder = prisma.decision.findFirst.mock.invocationCallOrder[0];
    const createOrder = prisma.executionRequest.create.mock.invocationCallOrder[0];
    expect(lookupOrder).toBeLessThan(createOrder);
  });

  // NC25's boundary half. Change the 422 to a fallthrough with
  // `decisionId: null` and this fails — which is the whole point, because that
  // change is invisible to the operator and re-opens the R10 gap.
  it('REFUSES (422) an id that does not resolve — never executes unattributed', async () => {
    prisma.decision.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/execute/meta')
      .send(body({ decisionId: 'someone-elses-decision' }))
      .expect(422);

    expect(res.body.code).toBe('ATTRIBUTION_UNRESOLVED');
    expect(prisma.executionRequest.create).not.toHaveBeenCalled();
  });

  it('REFUSES when the attribution lookup itself fails', async () => {
    prisma.decision.findFirst.mockRejectedValue(new Error('db down'));

    await request(app)
      .post('/api/execute/meta')
      .send(body({ decisionId: DECISION_ID }))
      .expect(422);

    expect(prisma.executionRequest.create).not.toHaveBeenCalled();
  });

  // Acting on a campaign no sweep has written a verdict for is a normal path
  // and must not require an attribution. Turning absence into a 422 would break
  // every ad-hoc execution.
  it('allows an execution with no decisionId, recorded as null', async () => {
    await request(app).post('/api/execute/meta').send(body()).expect(202);

    expect(prisma.decision.findFirst).not.toHaveBeenCalled();
    expect(prisma.executionRequest.create.mock.calls[0][0].data)
      .toHaveProperty('decisionId', null);
  });
});

describe('R10 · POST /api/execute/:id/retry — attribution travels', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use(firebaseAuthMiddleware);
    app.use('/api/execute', executionRouter);
  });

  // A retry is the same call being acted on again. Dropping the column here
  // would make the retried execution — the one that actually succeeds, in the
  // common case — the unattributed one.
  it('carries decisionId from the original onto the retried clone', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue({
      id: 'exec-failed-1', workspaceId: WS,
      actionType: 'PAUSE_ADSET', targetId: '120200000000002',
      payload: {}, status: 'EXECUTED_FAILED', correlationId: 'c-1',
      decisionId: DECISION_ID,
    });
    prisma.executionRequest.create.mockResolvedValue({
      id: 'exec-retry-1', workspaceId: WS, version: 0, correlationId: 'c-1',
    });
    lifecycleService.transition.mockResolvedValue({ id: 'exec-retry-1', status: 'QUEUED', version: 1 });

    await request(app).post('/api/execute/exec-failed-1/retry').expect(201);

    expect(prisma.executionRequest.create.mock.calls[0][0].data)
      .toHaveProperty('decisionId', DECISION_ID);
  });

  // The read must project the column. An unselected field is `undefined`, which
  // Prisma writes as "no value" — the clone would silently lose its attribution
  // with every test still green.
  it('selects decisionId from the original', async () => {
    prisma.executionRequest.findUnique.mockResolvedValue({
      id: 'exec-failed-1', workspaceId: WS, actionType: 'PAUSE_ADSET', targetId: '120200000000003',
      payload: {}, status: 'EXECUTED_FAILED', correlationId: 'c-1', decisionId: null,
    });
    prisma.executionRequest.create.mockResolvedValue({ id: 'r', workspaceId: WS, version: 0 });
    lifecycleService.transition.mockResolvedValue({ id: 'r', status: 'QUEUED', version: 1 });

    await request(app).post('/api/execute/exec-failed-1/retry').expect(201);

    expect(prisma.executionRequest.findUnique.mock.calls[0][0].select)
      .toHaveProperty('decisionId', true);
  });
});

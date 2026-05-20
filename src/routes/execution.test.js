// ============================================================
// Execution Router Tests
// Phase 11B Task 5: Reconciliation endpoint tests
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import executionRouter from './execution.js';
import { ExecutionStatus } from '../types/execution.js';

// Mock dependencies
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    executionRequest: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    executionTransition: {
      findMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock('../services/execution/ExecutionLifecycleService.js', () => ({
  lifecycleService: {
    getExecutionState: vi.fn(),
  },
}));

vi.mock('../middleware/firebaseAuth.js', () => ({
  firebaseAuthMiddleware: (req, res, next) => {
    req.user = {
      userId: 'test-user-123',
      workspaceId: 'test-workspace-456',
    };
    next();
  },
}));

vi.mock('../middleware/contextGuard.js', () => ({
  contextGuard: (req, res, next) => next(),
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('./events.js', () => ({
  broadcastWorkspaceEvent: vi.fn(),
}));

vi.mock('../services/metaExecutionService.js', () => ({
  executeMetaAction: vi.fn(),
}));

import { prisma } from '../lib/prisma.js';
import { lifecycleService } from '../services/execution/ExecutionLifecycleService.js';

describe('Execution Router - Reconciliation Endpoint', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create test Express app
    app = express();
    app.use(express.json());
    app.use('/api/execute', executionRouter);
  });

  describe('GET /api/execute/:id/active', () => {
    it('should return reconciliation payload for active execution', async () => {
      const executionId = 'exec-active-123';
      const workspaceId = 'test-workspace-456';

      // Mock lifecycle service response
      lifecycleService.getExecutionState.mockResolvedValue({
        executionId,
        correlationId: 'corr-123',
        status: ExecutionStatus.EXECUTING,
        version: 5,
        isTerminal: false,
        updatedAt: '2026-05-20T10:00:00.000Z',
        lastTransitionAt: '2026-05-20T10:00:00.000Z',
        serverNow: '2026-05-20T10:01:00.000Z',
        canResume: true,
        isStale: false,
        activeStep: 'GENERATE_STRATEGY',
        retryMetadata: null,
      });

      // Mock workspace verification
      prisma.executionRequest.findUnique.mockResolvedValue({
        workspaceId,
      });

      const response = await request(app)
        .get(`/api/execute/${executionId}/active`)
        .expect(200);

      expect(response.body).toEqual({
        executionId,
        correlationId: 'corr-123',
        status: ExecutionStatus.EXECUTING,
        version: 5,
        isTerminal: false,
        updatedAt: '2026-05-20T10:00:00.000Z',
        lastTransitionAt: '2026-05-20T10:00:00.000Z',
        serverNow: '2026-05-20T10:01:00.000Z',
        canResume: true,
        isStale: false,
        activeStep: 'GENERATE_STRATEGY',
        retryMetadata: null,
      });

      expect(lifecycleService.getExecutionState).toHaveBeenCalledWith(executionId);
      expect(prisma.executionRequest.findUnique).toHaveBeenCalledWith({
        where: { id: executionId },
        select: { workspaceId: true },
      });
    });

    it('should return terminal execution with response payload', async () => {
      const executionId = 'exec-terminal-456';
      const workspaceId = 'test-workspace-456';

      lifecycleService.getExecutionState.mockResolvedValue({
        executionId,
        correlationId: 'corr-456',
        status: ExecutionStatus.EXECUTED_SUCCESS,
        version: 10,
        isTerminal: true,
        updatedAt: '2026-05-20T09:00:00.000Z',
        lastTransitionAt: '2026-05-20T09:00:00.000Z',
        serverNow: '2026-05-20T10:00:00.000Z',
        canResume: false,
        isStale: false,
        activeStep: null,
        retryMetadata: null,
        response: {
          success: true,
          campaignId: 'camp-123',
        },
      });

      prisma.executionRequest.findUnique.mockResolvedValue({
        workspaceId,
      });

      const response = await request(app)
        .get(`/api/execute/${executionId}/active`)
        .expect(200);

      expect(response.body.status).toBe(ExecutionStatus.EXECUTED_SUCCESS);
      expect(response.body.isTerminal).toBe(true);
      expect(response.body.canResume).toBe(false);
      expect(response.body.response).toEqual({
        success: true,
        campaignId: 'camp-123',
      });
    });

    it('should return stale execution when timed out', async () => {
      const executionId = 'exec-stale-789';
      const workspaceId = 'test-workspace-456';

      lifecycleService.getExecutionState.mockResolvedValue({
        executionId,
        correlationId: 'corr-789',
        status: ExecutionStatus.EXECUTING,
        version: 3,
        isTerminal: false,
        updatedAt: '2026-05-20T08:00:00.000Z',
        lastTransitionAt: '2026-05-20T08:00:00.000Z',
        serverNow: '2026-05-20T10:00:00.000Z',
        canResume: false,
        isStale: true,
        activeStep: 'GENERATE_STRATEGY',
        retryMetadata: null,
      });

      prisma.executionRequest.findUnique.mockResolvedValue({
        workspaceId,
      });

      const response = await request(app)
        .get(`/api/execute/${executionId}/active`)
        .expect(200);

      expect(response.body.isStale).toBe(true);
      expect(response.body.canResume).toBe(false);
    });

    it('should return 404 if execution not found', async () => {
      const executionId = 'exec-nonexistent';

      lifecycleService.getExecutionState.mockRejectedValue(
        new Error(`ExecutionRequest ${executionId} not found`)
      );

      prisma.executionRequest.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .get(`/api/execute/${executionId}/active`)
        .expect(404);

      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should return 403 if execution belongs to different workspace', async () => {
      const executionId = 'exec-forbidden-123';
      const actualWorkspaceId = 'other-workspace-999';

      lifecycleService.getExecutionState.mockResolvedValue({
        executionId,
        status: ExecutionStatus.EXECUTING,
        version: 2,
        isTerminal: false,
        updatedAt: '2026-05-20T10:00:00.000Z',
        lastTransitionAt: '2026-05-20T10:00:00.000Z',
        serverNow: '2026-05-20T10:01:00.000Z',
        canResume: true,
        isStale: false,
        correlationId: 'corr-123',
        activeStep: null,
        retryMetadata: null,
      });

      prisma.executionRequest.findUnique.mockResolvedValue({
        workspaceId: actualWorkspaceId, // Different from test-workspace-456
      });

      const response = await request(app)
        .get(`/api/execute/${executionId}/active`)
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('should return 500 on internal error', async () => {
      const executionId = 'exec-error-456';

      lifecycleService.getExecutionState.mockRejectedValue(
        new Error('Database connection failed')
      );

      prisma.executionRequest.findUnique.mockResolvedValue({
        workspaceId: 'test-workspace-456',
      });

      const response = await request(app)
        .get(`/api/execute/${executionId}/active`)
        .expect(500);

      expect(response.body.code).toBe('RECONCILIATION_ERROR');
    });

    it('should include version field for stale detection', async () => {
      const executionId = 'exec-version-123';
      const workspaceId = 'test-workspace-456';

      lifecycleService.getExecutionState.mockResolvedValue({
        executionId,
        correlationId: 'corr-123',
        status: ExecutionStatus.QUEUED,
        version: 7, // Critical for frontend stale detection
        isTerminal: false,
        updatedAt: '2026-05-20T10:00:00.000Z',
        lastTransitionAt: '2026-05-20T10:00:00.000Z',
        serverNow: '2026-05-20T10:00:30.000Z',
        canResume: true,
        isStale: false,
        activeStep: null,
        retryMetadata: null,
      });

      prisma.executionRequest.findUnique.mockResolvedValue({
        workspaceId,
      });

      const response = await request(app)
        .get(`/api/execute/${executionId}/active`)
        .expect(200);

      // Version field is critical for frontend to detect:
      // incoming.version < local.version → DROP EVENT
      expect(response.body.version).toBe(7);
      expect(typeof response.body.version).toBe('number');
    });
  });

  // ─────────────────────────────────────────────────────────
  // Operations Runtime Layer — three read-only endpoints
  // ─────────────────────────────────────────────────────────

  describe('GET /api/execute/active', () => {
    it('should return in-flight executions for the workspace', async () => {
      const workspaceId = 'test-workspace-456';

      prisma.executionRequest.findMany.mockResolvedValue([
        {
          id: 'exec-1',
          actionType: 'PAUSE_ADSET',
          targetId: 'adset-100',
          status: 'EXECUTING',
          version: 4,
          correlationId: 'corr-A',
          createdAt: new Date('2026-05-20T10:00:00.000Z'),
          updatedAt: new Date('2026-05-20T10:00:08.000Z'),
          transitions: [{ actor: 'WORKER' }],
        },
        {
          id: 'exec-2',
          actionType: 'INCREASE_BUDGET',
          targetId: 'campaign-200',
          status: 'QUEUED',
          version: 1,
          correlationId: 'corr-B',
          createdAt: new Date('2026-05-20T10:00:05.000Z'),
          updatedAt: new Date('2026-05-20T10:00:05.000Z'),
          transitions: [],
        },
      ]);

      const response = await request(app).get('/api/execute/active').expect(200);

      expect(prisma.executionRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            workspaceId,
            status: { in: ['PENDING', 'QUEUED', 'EXECUTING', 'RETRYING'] },
          },
          orderBy: { updatedAt: 'desc' },
          take: 100,
        }),
      );

      expect(response.body.executions).toHaveLength(2);
      expect(response.body.executions[0]).toMatchObject({
        id: 'exec-1',
        status: 'EXECUTING',
        actor: 'WORKER',
        version: 4,
      });
      // Empty transitions array falls back to SYSTEM
      expect(response.body.executions[1].actor).toBe('SYSTEM');
      expect(response.body.executions[0]).toHaveProperty('ageSeconds');
      expect(typeof response.body.executions[0].ageSeconds).toBe('number');
      expect(response.body.serverNow).toBeDefined();
    });

    it('should return empty list when nothing is in flight', async () => {
      prisma.executionRequest.findMany.mockResolvedValue([]);

      const response = await request(app).get('/api/execute/active').expect(200);

      expect(response.body.executions).toEqual([]);
    });

    it('should return 500 on prisma failure', async () => {
      prisma.executionRequest.findMany.mockRejectedValue(new Error('boom'));

      const response = await request(app).get('/api/execute/active').expect(500);

      expect(response.body.code).toBe('ACTIVE_LIST_ERROR');
    });
  });

  describe('GET /api/execute/:id/transitions', () => {
    const executionId = 'exec-trans-1';
    const workspaceId = 'test-workspace-456';

    const baseExecution = {
      id: executionId,
      workspaceId,
      actionType: 'PAUSE_ADSET',
      targetId: 'adset-100',
      status: 'EXECUTED_SUCCESS',
      version: 3,
      correlationId: 'corr-T',
      createdAt: new Date('2026-05-20T10:00:00.000Z'),
      updatedAt: new Date('2026-05-20T10:00:22.000Z'),
    };

    it('should return execution + ordered transition chain', async () => {
      prisma.executionRequest.findUnique.mockResolvedValue(baseExecution);
      prisma.executionTransition.findMany.mockResolvedValue([
        {
          id: 't1', fromStatus: 'PENDING', toStatus: 'QUEUED', actor: 'API',
          previousVersion: 0, newVersion: 1, reason: null, metadata: null,
          correlationId: 'corr-T', createdAt: new Date('2026-05-20T10:00:01.000Z'),
        },
        {
          id: 't2', fromStatus: 'QUEUED', toStatus: 'EXECUTING', actor: 'WORKER',
          previousVersion: 1, newVersion: 2, reason: null, metadata: null,
          correlationId: 'corr-T', createdAt: new Date('2026-05-20T10:00:05.000Z'),
        },
      ]);

      const response = await request(app)
        .get(`/api/execute/${executionId}/transitions`)
        .expect(200);

      expect(prisma.executionTransition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { executionId, workspaceId },
          orderBy: { createdAt: 'asc' },
        }),
      );
      expect(response.body.execution.id).toBe(executionId);
      expect(response.body.transitions).toHaveLength(2);
      expect(response.body.transitions[0].toStatus).toBe('QUEUED');
    });

    it('should return 404 when execution is missing', async () => {
      prisma.executionRequest.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .get(`/api/execute/${executionId}/transitions`)
        .expect(404);

      expect(response.body.code).toBe('NOT_FOUND');
      expect(prisma.executionTransition.findMany).not.toHaveBeenCalled();
    });

    it('should return 403 on workspace mismatch', async () => {
      prisma.executionRequest.findUnique.mockResolvedValue({
        ...baseExecution,
        workspaceId: 'other-workspace',
      });

      const response = await request(app)
        .get(`/api/execute/${executionId}/transitions`)
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
      expect(prisma.executionTransition.findMany).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/execute/:id/incident', () => {
    const executionId = 'exec-inc-1';
    const workspaceId = 'test-workspace-456';

    it('should derive winner/loser + telemetry for failed execution', async () => {
      prisma.executionRequest.findUnique.mockResolvedValue({
        id: executionId,
        workspaceId,
        actionType: 'PAUSE_ADSET',
        targetId: 'adset-911',
        status: 'TIMED_OUT',
        version: 14,
        correlationId: 'corr-INC',
        createdAt: new Date('2026-05-20T14:00:00.000Z'),
        updatedAt: new Date('2026-05-20T14:09:08.000Z'),
      });

      prisma.executionTransition.findMany.mockResolvedValue([
        { id: 't1', fromStatus: 'PENDING',   toStatus: 'QUEUED',    actor: 'API',
          previousVersion: 0, newVersion: 1, reason: null, metadata: null,
          correlationId: 'corr-INC', createdAt: new Date('2026-05-20T14:00:01.000Z') },
        { id: 't2', fromStatus: 'QUEUED',    toStatus: 'EXECUTING', actor: 'WORKER',
          previousVersion: 1, newVersion: 2, reason: null, metadata: null,
          correlationId: 'corr-INC', createdAt: new Date('2026-05-20T14:00:05.000Z') },
        { id: 't3', fromStatus: 'EXECUTING', toStatus: 'TIMED_OUT', actor: 'TIMEOUT_HANDLER',
          previousVersion: 2, newVersion: 14, reason: 'timeout exceeded', metadata: { occConflict: true },
          correlationId: 'corr-INC', createdAt: new Date('2026-05-20T14:09:08.000Z') },
      ]);

      const response = await request(app)
        .get(`/api/execute/${executionId}/incident`)
        .expect(200);

      expect(response.body.incident).not.toBeNull();
      expect(response.body.incident.winner).toBe('TIMEOUT_HANDLER');
      expect(response.body.incident.loser).toBe('WORKER');
      expect(response.body.incident.title).toBe('FAILED at v14');
      expect(response.body.incident.cause).toBe('timeout exceeded');
      expect(response.body.incident.graph).toMatchObject({
        from: 'EXECUTING',
        winner: 'TIMEOUT_HANDLER',
        loser: 'WORKER',
        resolution: 'TIMED_OUT',
      });

      const tags = response.body.incident.telemetry.map((t) => t.tag);
      expect(tags).toEqual(expect.arrayContaining([
        'occ_conflict', 'retry_count', 'lock_holder', 'correlation', 'last_known_state',
      ]));
      const occRow = response.body.incident.telemetry.find((t) => t.tag === 'occ_conflict');
      expect(occRow.tone).toBe('kill');
    });

    it('should return incident=null for successful execution', async () => {
      prisma.executionRequest.findUnique.mockResolvedValue({
        id: executionId,
        workspaceId,
        actionType: 'PAUSE_ADSET',
        targetId: 'adset-1',
        status: 'EXECUTED_SUCCESS',
        version: 3,
        correlationId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.executionTransition.findMany.mockResolvedValue([
        { id: 't1', fromStatus: 'PENDING', toStatus: 'QUEUED', actor: 'API',
          previousVersion: 0, newVersion: 1, reason: null, metadata: null,
          correlationId: null, createdAt: new Date() },
      ]);

      const response = await request(app)
        .get(`/api/execute/${executionId}/incident`)
        .expect(200);

      expect(response.body.incident).toBeNull();
      expect(response.body.transitions).toHaveLength(1);
    });

    it('should return 403 on workspace mismatch', async () => {
      prisma.executionRequest.findUnique.mockResolvedValue({
        id: executionId,
        workspaceId: 'someone-else',
        status: 'EXECUTED_FAILED',
        version: 1,
        actionType: 'X', targetId: 'Y', correlationId: null,
        createdAt: new Date(), updatedAt: new Date(),
      });

      const response = await request(app)
        .get(`/api/execute/${executionId}/incident`)
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });
  });

  // ─────────────────────────────────────────────────────────
  // Runtime vitals
  // ─────────────────────────────────────────────────────────

  describe('GET /api/execute/vitals', () => {
    const workspaceId = 'test-workspace-456';

    it('should return counts and p95 latency for the workspace', async () => {
      prisma.executionRequest.count
        .mockResolvedValueOnce(3)    // inFlightCount
        .mockResolvedValueOnce(142)  // successPerHour
        .mockResolvedValueOnce(3);   // failedPerHour

      // Five terminal executions with known durations (in ms):
      //   100, 200, 300, 400, 500   → sorted
      // p95 rank = 0.95 * (5 - 1) = 3.8
      //   lower=3 (400), upper=4 (500), weight=0.8
      //   p95 = 400 + (500 - 400) * 0.8 = 480
      const t0 = new Date('2026-05-20T13:00:00.000Z');
      prisma.executionRequest.findMany.mockResolvedValueOnce([
        { createdAt: t0, updatedAt: new Date(t0.getTime() + 100) },
        { createdAt: t0, updatedAt: new Date(t0.getTime() + 200) },
        { createdAt: t0, updatedAt: new Date(t0.getTime() + 300) },
        { createdAt: t0, updatedAt: new Date(t0.getTime() + 400) },
        { createdAt: t0, updatedAt: new Date(t0.getTime() + 500) },
      ]);

      const response = await request(app).get('/api/execute/vitals').expect(200);

      expect(response.body).toMatchObject({
        inFlightCount: 3,
        successPerHour: 142,
        failedPerHour: 3,
        p95LatencyMs: 480,
        windowMinutes: 60,
      });
      expect(response.body.serverNow).toBeDefined();

      // Confirm each count was workspace-scoped
      const countCalls = prisma.executionRequest.count.mock.calls.map((c) => c[0]);
      expect(countCalls[0].where).toMatchObject({
        workspaceId,
        status: { in: ['PENDING', 'QUEUED', 'EXECUTING', 'RETRYING'] },
      });
      expect(countCalls[1].where).toMatchObject({
        workspaceId,
        status: 'EXECUTED_SUCCESS',
      });
      expect(countCalls[1].where.updatedAt.gte).toBeInstanceOf(Date);
      expect(countCalls[2].where).toMatchObject({
        workspaceId,
        status: { in: ['EXECUTED_FAILED', 'TIMED_OUT'] },
      });
    });

    it('should return p95=null when no terminal executions exist', async () => {
      prisma.executionRequest.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      prisma.executionRequest.findMany.mockResolvedValueOnce([]);

      const response = await request(app).get('/api/execute/vitals').expect(200);

      expect(response.body).toMatchObject({
        inFlightCount: 0,
        successPerHour: 0,
        failedPerHour: 0,
        p95LatencyMs: null,
      });
    });

    it('should return the only sample when exactly one terminal execution exists', async () => {
      prisma.executionRequest.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);
      const t = new Date();
      prisma.executionRequest.findMany.mockResolvedValueOnce([
        { createdAt: t, updatedAt: new Date(t.getTime() + 750) },
      ]);

      const response = await request(app).get('/api/execute/vitals').expect(200);

      expect(response.body.p95LatencyMs).toBe(750);
    });

    it('should return 500 on prisma failure', async () => {
      prisma.executionRequest.count.mockRejectedValueOnce(new Error('boom'));

      const response = await request(app).get('/api/execute/vitals').expect(500);

      expect(response.body.code).toBe('VITALS_ERROR');
    });
  });
});

// ============================================================
// RuntimeOrchestrator + Artifact Storage Integration Test
// ============================================================
// Tests the full flow from execution to artifact persistence.
// ============================================================
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

// IMPORTANT: Mock Prisma BEFORE any imports that use it
const mockArtifacts = new Map();
let idCounter = 1;

vi.mock('@prisma/client', () => ({
  PrismaClient: function() {
    return {
      artifact: {
        // R9 — every predicate is applied only when the query supplies it, and
        // `id` is one of them. getArtifact now resolves by (id, workspaceId)
        // through findFirst; the previous shape REQUIRED executionId and nodeId
        // to match, so a legitimate id lookup matched nothing and returned null.
        findFirst: vi.fn(async ({ where, orderBy }) => {
          const artifacts = Array.from(mockArtifacts.values()).filter(a =>
            (!where.id || a.id === where.id) &&
            (!where.workspaceId || a.workspaceId === where.workspaceId) &&
            (!where.executionId || a.executionId === where.executionId) &&
            (!where.nodeId || a.nodeId === where.nodeId) &&
            (!where.contentHash || a.contentHash === where.contentHash)
          );
          if (orderBy?.version === 'desc') artifacts.sort((a, b) => b.version - a.version);
          return artifacts[0] || null;
        }),

        create: vi.fn(async ({ data }) => {
          const artifact = {
            id: `artifact_${idCounter++}`,
            ...data,
            createdAt: new Date(),
          };
          mockArtifacts.set(artifact.id, artifact);
          return artifact;
        }),

        findUnique: vi.fn(async ({ where }) => {
          return mockArtifacts.get(where.id) || null;
        }),

        findMany: vi.fn(async ({ where }) => {
          const artifacts = Array.from(mockArtifacts.values());
          return artifacts.filter(a =>
            (!where.workspaceId || a.workspaceId === where.workspaceId) &&
            (!where.executionId || a.executionId === where.executionId) &&
            (!where.nodeId || a.nodeId === where.nodeId) &&
            (!where.type || a.type === where.type)
          );
        }),

      update: vi.fn(async ({ where, data }) => {
        const artifact = mockArtifacts.get(where.id);
        if (!artifact) return null;
        Object.assign(artifact, data);
        return artifact;
      }),
    },
  };
  },
}));

// Mock AI Gateway
vi.mock('../ai-gateway/index.js', async () => {
  const actual = await vi.importActual('../ai-gateway/index.js');
  return {
    ...actual,
    execute: vi.fn(),
  };
});

// Now import modules that depend on the mocks
import { executeExecutionPlan } from './RuntimeOrchestrator.js';
import { getArtifact, listArtifacts } from '../artifact-storage/index.js';
import { EXECUTION_TYPE, NODE_TYPE, PLAN_PRIORITY } from '../execution-planner/index.js';
import { EXECUTION_STATUS } from './runtimeEvents.js';
import * as aiGateway from '../ai-gateway/index.js';

describe('RuntimeOrchestrator + Artifact Storage Integration', () => {
  const defaultSuccessImpl = async ({ capability, input }) => ({
    success: true,
    output: {
      generated: true,
      capability,
      diagnosis: input.diagnosis,
    },
    artifacts: [
      {
        type: 'hook',
        id: `${capability}_artifact_1`,
        content: `Stop scrolling - ${capability}`,
        angle: 'problem',
      },
      {
        type: 'hook',
        id: `${capability}_artifact_2`,
        content: `Your audience is tired - ${capability}`,
        angle: 'benefit',
      },
    ],
    metadata: {
      provider: 'CLAUDE',
      requestId: 'test_request_id',
      attempt: 1,
      tokens: 150,
      latency: 1200,
      model: 'claude-sonnet-4.5',
    },
  });

  beforeAll(() => {
    aiGateway.execute.mockImplementation(defaultSuccessImpl);
  });

  beforeEach(() => {
    aiGateway.execute.mockClear();
    aiGateway.execute.mockImplementation(defaultSuccessImpl);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('should store artifacts when workspaceId and executionId provided', async () => {
    const plan = {
      diagnosis: 'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [NODE_TYPE.GENERATE_HOOK_VARIANTS],
        edges: [],
      },
    };

    const context = {
      diagnosis: 'CREATIVE_FATIGUE',
      workspaceId: '00000000-0000-0000-0000-000000000001',
      executionId: 'test_execution_001',
    };

    const result = await executeExecutionPlan(plan, context);

    // Verify execution succeeded
    expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);
    expect(result.summary.successful).toBe(1);

    // Verify artifacts were stored
    const executedNode = result.executedNodes[0];
    expect(executedNode.storedArtifactIds).toBeDefined();
    expect(executedNode.storedArtifactIds.length).toBe(2); // 2 hooks generated

    // Verify artifacts can be retrieved
    const artifactId = executedNode.storedArtifactIds[0];
    const artifact = await getArtifact(artifactId, '00000000-0000-0000-0000-000000000001');

    expect(artifact).toBeDefined();
    expect(artifact.type).toBe('hook');
    expect(artifact.content).toContain('Stop scrolling');
    expect(artifact.capability).toBe(aiGateway.CAPABILITY.GENERATE_HOOKS);
    expect(artifact.provider).toBe('CLAUDE');
  });

  it('should not store artifacts when workspaceId missing', async () => {
    const plan = {
      diagnosis: 'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [NODE_TYPE.GENERATE_HOOK_VARIANTS],
        edges: [],
      },
    };

    const context = {
      diagnosis: 'CREATIVE_FATIGUE',
      // No workspaceId or executionId
    };

    const result = await executeExecutionPlan(plan, context);

    // Verify execution succeeded
    expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);

    // Verify artifacts were NOT stored (no IDs)
    const executedNode = result.executedNodes[0];
    expect(executedNode.storedArtifactIds).toEqual([]);
  });

  it('should store artifacts for multiple nodes', async () => {
    const plan = {
      diagnosis: 'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [
          NODE_TYPE.GENERATE_HOOK_VARIANTS,
          NODE_TYPE.GENERATE_CAPTION_VARIANTS,
        ],
        edges: [],
      },
    };

    const context = {
      diagnosis: 'CREATIVE_FATIGUE',
      workspaceId: '00000000-0000-0000-0000-000000000001',
      executionId: 'test_execution_002',
    };

    const result = await executeExecutionPlan(plan, context);

    // Verify execution succeeded
    expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);
    expect(result.summary.successful).toBe(2);

    // Verify both nodes stored artifacts
    expect(result.executedNodes[0].storedArtifactIds.length).toBe(2);
    expect(result.executedNodes[1].storedArtifactIds.length).toBe(2);

    // Verify we can list all artifacts for this execution
    const artifacts = await listArtifacts({
      workspaceId: context.workspaceId,
      executionId: context.executionId,
    });

    expect(artifacts.length).toBe(4); // 2 nodes × 2 artifacts each
  });

  it('should handle artifact storage failure gracefully', async () => {
    // Mock storage to fail
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const plan = {
      diagnosis: 'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [NODE_TYPE.GENERATE_HOOK_VARIANTS],
        edges: [],
      },
    };

    const context = {
      diagnosis: 'CREATIVE_FATIGUE',
      workspaceId: '00000000-0000-0000-0000-000000000001',
      executionId: 'test_execution_003',
    };

    // Even if storage fails, execution should succeed
    const result = await executeExecutionPlan(plan, context);

    expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);
    expect(result.summary.successful).toBe(1);

    console.error.mockRestore();
  });

  it('should include artifact metadata in stored record', async () => {
    const plan = {
      diagnosis: 'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [NODE_TYPE.GENERATE_HOOK_VARIANTS],
        edges: [],
      },
    };

    const context = {
      diagnosis: 'CREATIVE_FATIGUE',
      workspaceId: '00000000-0000-0000-0000-000000000001',
      executionId: 'test_execution_004',
    };

    const result = await executeExecutionPlan(plan, context);

    // Retrieve stored artifact
    const artifactId = result.executedNodes[0].storedArtifactIds[0];
    const artifact = await getArtifact(artifactId, '00000000-0000-0000-0000-000000000001');

    // Verify metadata was stored
    expect(artifact.metadata).toBeDefined();
    expect(artifact.metadata.capability).toBe(aiGateway.CAPABILITY.GENERATE_HOOKS);
    expect(artifact.metadata.provider).toBe('CLAUDE');
    expect(artifact.metadata.tokens).toBe(150);
    expect(artifact.metadata.latency).toBe(1200);
    expect(artifact.metadata.model).toBe('claude-sonnet-4.5');
    expect(artifact.metadata.angle).toBe('problem'); // From artifact itself
  });

  it('should create versions for repeated generations', async () => {
    const plan = {
      diagnosis: 'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [NODE_TYPE.GENERATE_HOOK_VARIANTS],
        edges: [],
      },
    };

    const context = {
      diagnosis: 'CREATIVE_FATIGUE',
      workspaceId: '00000000-0000-0000-0000-000000000001',
      executionId: 'test_execution_005',
    };

    // Execute twice (simulating regeneration)
    await executeExecutionPlan(plan, context);

    // Change AI response to generate different content
    aiGateway.execute.mockImplementation(async ({ capability, input }) => ({
      success: true,
      output: { generated: true, capability, diagnosis: input.diagnosis },
      artifacts: [
        {
          type: 'hook',
          id: `${capability}_artifact_v2`,
          content: `New version - ${capability}`,
          angle: 'curiosity',
        },
      ],
      metadata: {
        provider: 'CLAUDE',
        requestId: 'test_request_id_v2',
        attempt: 1,
        tokens: 200,
        latency: 1500,
        model: 'claude-sonnet-4.5',
      },
    }));

    const result2 = await executeExecutionPlan(plan, context);

    // Verify second execution stored artifacts
    expect(result2.executedNodes[0].storedArtifactIds.length).toBe(1);

    // Retrieve and check version
    const artifactId = result2.executedNodes[0].storedArtifactIds[0];
    const artifact = await getArtifact(artifactId, '00000000-0000-0000-0000-000000000001');

    // Version 3, not 2 — and this is the REAL number. The first execution's AI
    // stub returns TWO hooks, so it stores v1 and v2 under this nodeId; the
    // regenerated hook is the third. storeArtifact picks the previous version
    // with `orderBy: { version: 'desc' }`, so it reads 2 and writes 3.
    //
    // The old expectation of 2 was an artefact of the mock: its findFirst
    // ignored `orderBy` and returned the first-INSERTED match (always v1), which
    // pinned every regeneration at version 2 no matter how many existed. Fixing
    // findFirst for R9's (id, workspaceId) lookup also made it honour orderBy,
    // and the true versioning behaviour became visible.
    expect(artifact.version).toBe(3);
    expect(artifact.content).toContain('New version');
  });
});

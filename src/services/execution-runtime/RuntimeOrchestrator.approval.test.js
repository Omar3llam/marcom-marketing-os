// ============================================================
// RuntimeOrchestrator + Approval Integration Test
// ============================================================
// Tests automatic approval request creation for artifacts that
// require human review.
//
// Tests:
//   - Approval requests created for hooks/captions/angles
//   - No approval requests for visual_brief/audience_hypothesis
//   - Multiple artifacts handled correctly
//   - Approval creation failure doesn't fail execution
// ============================================================
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

// Mock logger BEFORE any imports (avoids config dependency)
vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// IMPORTANT: Mock Prisma BEFORE any imports that use it
const mockArtifacts = new Map();
const mockApprovals = new Map();
let artifactIdCounter = 1;
let approvalIdCounter = 1;

vi.mock('@prisma/client', () => ({
  PrismaClient: function() {
    return {
      artifact: {
        findFirst: vi.fn(async ({ where }) => {
          const artifacts = Array.from(mockArtifacts.values());
          return artifacts.find(a =>
            a.workspaceId === where.workspaceId &&
            a.executionId === where.executionId &&
            a.nodeId === where.nodeId &&
            (!where.contentHash || a.contentHash === where.contentHash)
          ) || null;
        }),

        create: vi.fn(async ({ data }) => {
          const artifact = {
            id: `artifact_${artifactIdCounter++}`,
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

      artifactApproval: {
        create: vi.fn(async ({ data }) => {
          const approval = {
            id: `approval_${approvalIdCounter++}`,
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          mockApprovals.set(approval.id, approval);
          return approval;
        }),

        findUnique: vi.fn(async ({ where }) => {
          return Array.from(mockApprovals.values()).find(a => a.artifactId === where.artifactId) || null;
        }),

        findMany: vi.fn(async ({ where }) => {
          const approvals = Array.from(mockApprovals.values());
          return approvals.filter(a =>
            (!where.workspaceId || a.workspaceId === where.workspaceId) &&
            (!where.status || a.status === where.status)
          );
        }),

        findFirst: vi.fn(async () => {
          return Array.from(mockApprovals.values())[0] || null;
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
import { EXECUTION_TYPE, NODE_TYPE, PLAN_PRIORITY } from '../execution-planner/index.js';
import { EXECUTION_STATUS } from './runtimeEvents.js';
import * as aiGateway from '../ai-gateway/index.js';
import { APPROVAL_STATUS } from '../artifact-approval/index.js';

describe('RuntimeOrchestrator + Approval Integration', () => {
  const defaultSuccessImpl = async ({ capability }) => ({
    success: true,
    output: {
      generated: true,
      capability,
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
    mockArtifacts.clear();
    mockApprovals.clear();
    artifactIdCounter = 1;
    approvalIdCounter = 1;
    aiGateway.execute.mockClear();
    aiGateway.execute.mockImplementation(defaultSuccessImpl);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('should create approval requests for hook artifacts', async () => {
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

    // Verify artifacts were stored
    expect(result.executedNodes[0].storedArtifactIds.length).toBe(2);

    // Verify approval requests were created
    const approvals = Array.from(mockApprovals.values());
    expect(approvals.length).toBe(2);

    // Verify approval details
    approvals.forEach(approval => {
      expect(approval.workspaceId).toBe(context.workspaceId);
      expect(approval.status).toBe(APPROVAL_STATUS.PENDING);
      expect(mockArtifacts.has(approval.artifactId)).toBe(true);
    });
  });

  it('should create approval requests for caption artifacts', async () => {
    // Mock caption generation
    aiGateway.execute.mockImplementation(async ({ capability }) => ({
      success: true,
      output: { generated: true, capability },
      artifacts: [
        {
          type: 'caption',
          id: `${capability}_caption_1`,
          content: 'Test caption content',
        },
      ],
      metadata: {
        provider: 'CLAUDE',
        requestId: 'test_request_id',
        tokens: 100,
        latency: 800,
        model: 'claude-sonnet-4.5',
      },
    }));

    const plan = {
      diagnosis: 'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [NODE_TYPE.GENERATE_CAPTION_VARIANTS],
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

    // Verify approval request created
    const approvals = Array.from(mockApprovals.values());
    expect(approvals.length).toBe(1);
    expect(approvals[0].status).toBe(APPROVAL_STATUS.PENDING);
  });

  it('should NOT create approval requests for visual_brief artifacts', async () => {
    // Mock visual brief generation
    aiGateway.execute.mockImplementation(async ({ capability }) => ({
      success: true,
      output: { generated: true, capability },
      artifacts: [
        {
          type: 'visual_brief',
          id: `${capability}_brief_1`,
          content: 'Visual brief content',
        },
      ],
      metadata: {
        provider: 'CLAUDE',
        requestId: 'test_request_id',
        tokens: 200,
        latency: 1500,
        model: 'claude-sonnet-4.5',
      },
    }));

    const plan = {
      diagnosis: 'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [NODE_TYPE.GENERATE_VISUAL_BRIEF],
        edges: [],
      },
    };

    const context = {
      diagnosis: 'CREATIVE_FATIGUE',
      workspaceId: '00000000-0000-0000-0000-000000000001',
      executionId: 'test_execution_003',
    };

    const result = await executeExecutionPlan(plan, context);

    // Verify execution succeeded
    expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);

    // Verify artifact was stored
    expect(result.executedNodes[0].storedArtifactIds.length).toBe(1);

    // Verify NO approval requests created
    const approvals = Array.from(mockApprovals.values());
    expect(approvals.length).toBe(0);
  });

  it('should handle mixed artifact types correctly', async () => {
    // Mock generation with mixed types
    aiGateway.execute.mockImplementation(async ({ capability }) => ({
      success: true,
      output: { generated: true, capability },
      artifacts: [
        {
          type: 'hook',
          id: `${capability}_hook_1`,
          content: 'Test hook',
        },
        {
          type: 'visual_brief',
          id: `${capability}_brief_1`,
          content: 'Test brief',
        },
      ],
      metadata: {
        provider: 'CLAUDE',
        requestId: 'test_request_id',
        tokens: 200,
        latency: 1500,
        model: 'claude-sonnet-4.5',
      },
    }));

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

    // Verify execution succeeded
    expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);

    // Verify 2 artifacts stored
    expect(result.executedNodes[0].storedArtifactIds.length).toBe(2);

    // Verify only 1 approval request created (for hook only)
    const approvals = Array.from(mockApprovals.values());
    expect(approvals.length).toBe(1);

    // Verify it's for the hook artifact
    const hookArtifact = Array.from(mockArtifacts.values()).find(a => a.type === 'hook');
    expect(approvals[0].artifactId).toBe(hookArtifact.id);
  });

  it('should handle approval creation failure gracefully', async () => {
    // Mock approval creation to fail
    const createSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Temporarily break approval creation
    const originalCreate = mockApprovals.set;
    mockApprovals.set = () => {
      throw new Error('Approval creation failed');
    };

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

    // Execution should still succeed
    const result = await executeExecutionPlan(plan, context);

    expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);
    expect(result.executedNodes[0].storedArtifactIds.length).toBe(2);

    // Restore
    mockApprovals.set = originalCreate;
    createSpy.mockRestore();
  });

  it('should create separate approval requests for multiple nodes', async () => {
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
      executionId: 'test_execution_006',
    };

    const result = await executeExecutionPlan(plan, context);

    // Verify execution succeeded
    expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);
    expect(result.summary.successful).toBe(2);

    // Verify artifacts from both nodes
    const totalArtifacts = result.executedNodes.reduce((sum, node) => sum + node.storedArtifactIds.length, 0);
    expect(totalArtifacts).toBe(4); // 2 hooks + 2 captions

    // Verify approval requests created for all 4 artifacts
    const approvals = Array.from(mockApprovals.values());
    expect(approvals.length).toBe(4);
  });

  it('should not create approvals when workspaceId missing', async () => {
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

    // Verify NO artifacts stored (no workspaceId)
    expect(result.executedNodes[0].storedArtifactIds).toEqual([]);

    // Verify NO approval requests created
    const approvals = Array.from(mockApprovals.values());
    expect(approvals.length).toBe(0);
  });
});

// ============================================================
// RuntimeOrchestrator — comprehensive test suite
// ============================================================
// Ensures deterministic execution, correct failure handling,
// and stable event ordering across all execution patterns.
//
// Coverage:
//   - Input validation
//   - Graph execution (empty, single, linear, branching)
//   - Failure propagation (skip dependents)
//   - Retry logic (bounded retries)
//   - Event ordering (deterministic)
//   - Fixture scenarios (12 canonical scenarios)
// ============================================================
import { describe, it, expect, vi } from 'vitest';

// Mock logger BEFORE imports
vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { executeExecutionPlan }    from './RuntimeOrchestrator.js';
import { ExecutionGraph }          from './ExecutionGraph.js';
import { RUNTIME_EVENT, EXECUTION_STATUS, NODE_STATUS } from './runtimeEvents.js';
import { EXECUTION_TYPE, NODE_TYPE, PLAN_PRIORITY }     from '../execution-planner/index.js';
import { SCENARIOS }               from './fixtures/scenarios.js';

// ============================================================
// Input Validation
// ============================================================

describe('RuntimeOrchestrator — input validation', () => {
  it('should reject null plan', async () => {
    await expect(executeExecutionPlan(null)).rejects.toThrow('plan must be a non-null object');
  });

  it('should reject undefined plan', async () => {
    await expect(executeExecutionPlan(undefined)).rejects.toThrow('plan must be a non-null object');
  });

  it('should reject non-object plan', async () => {
    await expect(executeExecutionPlan('not-an-object')).rejects.toThrow('plan must be a non-null object');
  });

  it('should reject plan with missing diagnosis', async () => {
    const plan = {
      executionType: EXECUTION_TYPE.HOLD,
      priority: PLAN_PRIORITY.HIGH,
      graph: { nodes: [], edges: [] },
    };
    await expect(executeExecutionPlan(plan)).rejects.toThrow('diagnosis must be a non-empty string');
  });

  it('should reject plan with empty diagnosis', async () => {
    const plan = {
      diagnosis: '   ',
      executionType: EXECUTION_TYPE.HOLD,
      priority: PLAN_PRIORITY.HIGH,
      graph: { nodes: [], edges: [] },
    };
    await expect(executeExecutionPlan(plan)).rejects.toThrow('diagnosis must be a non-empty string');
  });

  it('should reject plan with missing executionType', async () => {
    const plan = {
      diagnosis: 'TEST',
      priority: PLAN_PRIORITY.HIGH,
      graph: { nodes: [], edges: [] },
    };
    await expect(executeExecutionPlan(plan)).rejects.toThrow('executionType must be a non-empty string');
  });

  it('should reject plan with missing priority', async () => {
    const plan = {
      diagnosis: 'TEST',
      executionType: EXECUTION_TYPE.HOLD,
      graph: { nodes: [], edges: [] },
    };
    await expect(executeExecutionPlan(plan)).rejects.toThrow('priority must be a non-empty string');
  });

  it('should reject plan with missing graph', async () => {
    const plan = {
      diagnosis: 'TEST',
      executionType: EXECUTION_TYPE.HOLD,
      priority: PLAN_PRIORITY.HIGH,
    };
    await expect(executeExecutionPlan(plan)).rejects.toThrow('graph must be a non-null object');
  });

  it('should reject plan with invalid graph.nodes', async () => {
    const plan = {
      diagnosis: 'TEST',
      executionType: EXECUTION_TYPE.HOLD,
      priority: PLAN_PRIORITY.HIGH,
      graph: { nodes: 'not-an-array', edges: [] },
    };
    await expect(executeExecutionPlan(plan)).rejects.toThrow('graph.nodes must be an array');
  });

  it('should reject plan with invalid graph.edges', async () => {
    const plan = {
      diagnosis: 'TEST',
      executionType: EXECUTION_TYPE.HOLD,
      priority: PLAN_PRIORITY.HIGH,
      graph: { nodes: [], edges: 'not-an-array' },
    };
    await expect(executeExecutionPlan(plan)).rejects.toThrow('graph.edges must be an array');
  });
});

// ============================================================
// Output Shape
// ============================================================

describe('RuntimeOrchestrator — output shape', () => {
  it('should return correct top-level structure', async () => {
    const plan = {
      diagnosis: 'TEST',
      executionType: EXECUTION_TYPE.HOLD,
      priority: PLAN_PRIORITY.HIGH,
      graph: { nodes: [], edges: [] },
    };

    const result = await executeExecutionPlan(plan);

    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('executedNodes');
    expect(result).toHaveProperty('events');
    expect(result).toHaveProperty('summary');
    expect(Array.isArray(result.executedNodes)).toBe(true);
    expect(Array.isArray(result.events)).toBe(true);
    expect(typeof result.summary).toBe('object');
  });

  it('should include summary with correct fields', async () => {
    const plan = {
      diagnosis: 'TEST',
      executionType: EXECUTION_TYPE.HOLD,
      priority: PLAN_PRIORITY.HIGH,
      graph: { nodes: [], edges: [] },
    };

    const result = await executeExecutionPlan(plan);

    expect(result.summary).toHaveProperty('totalNodes');
    expect(result.summary).toHaveProperty('successful');
    expect(result.summary).toHaveProperty('failed');
    expect(result.summary).toHaveProperty('skipped');
  });
});

// ============================================================
// Empty Graph
// ============================================================

describe('RuntimeOrchestrator — empty graph', () => {
  it('should execute empty graph as no-op success', async () => {
    const plan = {
      diagnosis: 'TEST',
      executionType: EXECUTION_TYPE.HOLD,
      priority: PLAN_PRIORITY.LOW,
      graph: { nodes: [], edges: [] },
    };

    const result = await executeExecutionPlan(plan);

    expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);
    expect(result.executedNodes).toHaveLength(0);
    expect(result.summary.totalNodes).toBe(0);
    expect(result.summary.successful).toBe(0);
  });

  it('should emit execution start/success events for empty graph', async () => {
    const plan = {
      diagnosis: 'TEST',
      executionType: EXECUTION_TYPE.HOLD,
      priority: PLAN_PRIORITY.LOW,
      graph: { nodes: [], edges: [] },
    };

    const result = await executeExecutionPlan(plan);

    expect(result.events.length).toBeGreaterThanOrEqual(2);
    expect(result.events[0].type).toBe(RUNTIME_EVENT.EXECUTION_START);
    expect(result.events[result.events.length - 1].type).toBe(RUNTIME_EVENT.EXECUTION_SUCCESS);
  });
});

// ============================================================
// Single Node Execution
// ============================================================

describe('RuntimeOrchestrator — single node', () => {
  it('should execute single node successfully', async () => {
    const plan = {
      diagnosis: 'HEALTHY',
      executionType: EXECUTION_TYPE.HOLD,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [NODE_TYPE.CONTINUE_MONITORING],
        edges: [],
      },
    };

    const result = await executeExecutionPlan(plan);

    expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);
    expect(result.executedNodes).toHaveLength(1);
    expect(result.executedNodes[0].status).toBe(NODE_STATUS.SUCCESS);
    expect(result.summary.successful).toBe(1);
  });

  it('should emit correct events for single node', async () => {
    const plan = {
      diagnosis: 'HEALTHY',
      executionType: EXECUTION_TYPE.HOLD,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [NODE_TYPE.CONTINUE_MONITORING],
        edges: [],
      },
    };

    const result = await executeExecutionPlan(plan);

    const nodeEvents = result.events.filter(e => e.type.startsWith('NODE_'));
    expect(nodeEvents.length).toBeGreaterThanOrEqual(2);
    expect(nodeEvents[0].type).toBe(RUNTIME_EVENT.NODE_START);
    expect(nodeEvents[nodeEvents.length - 1].type).toBe(RUNTIME_EVENT.NODE_SUCCESS);
  });

  it('should include output and artifacts for single node', async () => {
    const plan = {
      diagnosis: 'HEALTHY',
      executionType: EXECUTION_TYPE.HOLD,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [NODE_TYPE.CONTINUE_MONITORING],
        edges: [],
      },
    };

    const result = await executeExecutionPlan(plan);

    expect(result.executedNodes[0]).toHaveProperty('output');
    expect(result.executedNodes[0]).toHaveProperty('artifacts');
    expect(Array.isArray(result.executedNodes[0].artifacts)).toBe(true);
  });
});

// ============================================================
// Linear Graph Execution Order
// ============================================================

describe('RuntimeOrchestrator — linear graph', () => {
  it('should execute linear graph in correct order', async () => {
    const plan = {
      diagnosis: 'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [
          NODE_TYPE.GENERATE_HOOK_VARIANTS,
          NODE_TYPE.VALIDATE_HOOKS,
          NODE_TYPE.RANK_HOOKS,
        ],
        edges: [
          { from: NODE_TYPE.GENERATE_HOOK_VARIANTS, to: NODE_TYPE.VALIDATE_HOOKS },
          { from: NODE_TYPE.VALIDATE_HOOKS,         to: NODE_TYPE.RANK_HOOKS },
        ],
      },
    };

    const result = await executeExecutionPlan(plan);

    expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);
    expect(result.executedNodes).toHaveLength(3);

    const executionOrder = result.executedNodes.map(n => n.nodeType);
    expect(executionOrder).toEqual([
      NODE_TYPE.GENERATE_HOOK_VARIANTS,
      NODE_TYPE.VALIDATE_HOOKS,
      NODE_TYPE.RANK_HOOKS,
    ]);
  });

  it('should execute all nodes successfully in linear graph', async () => {
    const plan = {
      diagnosis: 'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [
          NODE_TYPE.GENERATE_HOOK_VARIANTS,
          NODE_TYPE.VALIDATE_HOOKS,
          NODE_TYPE.RANK_HOOKS,
        ],
        edges: [
          { from: NODE_TYPE.GENERATE_HOOK_VARIANTS, to: NODE_TYPE.VALIDATE_HOOKS },
          { from: NODE_TYPE.VALIDATE_HOOKS,         to: NODE_TYPE.RANK_HOOKS },
        ],
      },
    };

    const result = await executeExecutionPlan(plan);

    expect(result.summary.successful).toBe(3);
    expect(result.summary.failed).toBe(0);
    expect(result.summary.skipped).toBe(0);
  });
});

// ============================================================
// Branching Graph
// ============================================================

describe('RuntimeOrchestrator — branching graph', () => {
  it('should execute all branches in branching graph', async () => {
    const plan = {
      diagnosis: 'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [
          NODE_TYPE.GENERATE_HOOK_VARIANTS,
          NODE_TYPE.GENERATE_CAPTION_VARIANTS,
          NODE_TYPE.VALIDATE_HOOKS,
        ],
        edges: [],
      },
    };

    const result = await executeExecutionPlan(plan);

    expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);
    expect(result.executedNodes).toHaveLength(3);
    expect(result.summary.successful).toBe(3);
  });

  it('should maintain deterministic order in branching graph', async () => {
    const plan = {
      diagnosis: 'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [
          NODE_TYPE.GENERATE_HOOK_VARIANTS,
          NODE_TYPE.GENERATE_CAPTION_VARIANTS,
          NODE_TYPE.VALIDATE_HOOKS,
        ],
        edges: [],
      },
    };

    const result1 = await executeExecutionPlan(plan);
    const result2 = await executeExecutionPlan(plan);

    const order1 = result1.executedNodes.map(n => n.nodeType);
    const order2 = result2.executedNodes.map(n => n.nodeType);

    expect(order1).toEqual(order2);
  });
});

// ============================================================
// Failed Node Propagation
// ============================================================

describe('RuntimeOrchestrator — failure propagation', () => {
  it('should skip dependent nodes when parent fails', async () => {
    const plan = {
      diagnosis: 'TEST_FAILURE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [
          'UNKNOWN_NODE_TYPE',
          NODE_TYPE.VALIDATE_HOOKS,
        ],
        edges: [
          { from: 'UNKNOWN_NODE_TYPE', to: NODE_TYPE.VALIDATE_HOOKS },
        ],
      },
    };

    const result = await executeExecutionPlan(plan);

    expect(result.status).toBe(EXECUTION_STATUS.FAILURE);
    expect(result.summary.failed).toBe(1);
    expect(result.summary.skipped).toBe(1);

    const skippedNode = result.executedNodes.find(n => n.nodeType === NODE_TYPE.VALIDATE_HOOKS);
    expect(skippedNode.status).toBe(NODE_STATUS.SKIPPED);
  });

  it('should emit NODE_SKIPPED event for dependent nodes', async () => {
    const plan = {
      diagnosis: 'TEST_FAILURE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [
          'UNKNOWN_NODE_TYPE',
          NODE_TYPE.VALIDATE_HOOKS,
        ],
        edges: [
          { from: 'UNKNOWN_NODE_TYPE', to: NODE_TYPE.VALIDATE_HOOKS },
        ],
      },
    };

    const result = await executeExecutionPlan(plan);

    const skippedEvents = result.events.filter(e => e.type === RUNTIME_EVENT.NODE_SKIPPED);
    expect(skippedEvents.length).toBeGreaterThan(0);
  });

  it('should propagate failure through entire chain', async () => {
    const plan = {
      diagnosis: 'TEST_FAILURE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [
          'UNKNOWN_NODE_TYPE',
          NODE_TYPE.VALIDATE_HOOKS,
          NODE_TYPE.RANK_HOOKS,
        ],
        edges: [
          { from: 'UNKNOWN_NODE_TYPE',  to: NODE_TYPE.VALIDATE_HOOKS },
          { from: NODE_TYPE.VALIDATE_HOOKS, to: NODE_TYPE.RANK_HOOKS },
        ],
      },
    };

    const result = await executeExecutionPlan(plan);

    expect(result.status).toBe(EXECUTION_STATUS.FAILURE);
    expect(result.summary.failed).toBe(1);
    expect(result.summary.skipped).toBe(2);
  });
});

// ============================================================
// Partial Success
// ============================================================

describe('RuntimeOrchestrator — partial success', () => {
  it('should report PARTIAL_SUCCESS when some nodes fail', async () => {
    const plan = {
      diagnosis: 'TEST_PARTIAL',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority: PLAN_PRIORITY.MEDIUM,
      graph: {
        nodes: [
          NODE_TYPE.GENERATE_HOOK_VARIANTS,
          'UNKNOWN_NODE_TYPE',
          NODE_TYPE.RANK_HOOKS,
        ],
        edges: [],
      },
    };

    const result = await executeExecutionPlan(plan);

    expect(result.status).toBe(EXECUTION_STATUS.PARTIAL_SUCCESS);
    expect(result.summary.successful).toBeGreaterThan(0);
    expect(result.summary.failed).toBeGreaterThan(0);
  });
});

// ============================================================
// Determinism
// ============================================================

describe('RuntimeOrchestrator — determinism', () => {
  it('should produce same execution order for same plan', async () => {
    const plan = {
      diagnosis: 'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [
          NODE_TYPE.GENERATE_HOOK_VARIANTS,
          NODE_TYPE.VALIDATE_HOOKS,
        ],
        edges: [
          { from: NODE_TYPE.GENERATE_HOOK_VARIANTS, to: NODE_TYPE.VALIDATE_HOOKS },
        ],
      },
    };

    const result1 = await executeExecutionPlan(plan);
    const result2 = await executeExecutionPlan(plan);

    const order1 = result1.executedNodes.map(n => n.nodeType);
    const order2 = result2.executedNodes.map(n => n.nodeType);

    expect(order1).toEqual(order2);
  });

  it('should produce same event sequence for same plan', async () => {
    const plan = {
      diagnosis: 'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [
          NODE_TYPE.GENERATE_HOOK_VARIANTS,
          NODE_TYPE.VALIDATE_HOOKS,
        ],
        edges: [
          { from: NODE_TYPE.GENERATE_HOOK_VARIANTS, to: NODE_TYPE.VALIDATE_HOOKS },
        ],
      },
    };

    const result1 = await executeExecutionPlan(plan);
    const result2 = await executeExecutionPlan(plan);

    const eventTypes1 = result1.events.map(e => e.type);
    const eventTypes2 = result2.events.map(e => e.type);

    expect(eventTypes1).toEqual(eventTypes2);
  });

  it('should produce same output for same node type', async () => {
    const plan = {
      diagnosis: 'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [NODE_TYPE.GENERATE_HOOK_VARIANTS],
        edges: [],
      },
    };

    const result1 = await executeExecutionPlan(plan);
    const result2 = await executeExecutionPlan(plan);

    expect(result1.executedNodes[0].output).toEqual(result2.executedNodes[0].output);
  });
});

// ============================================================
// Event Ordering
// ============================================================

describe('RuntimeOrchestrator — event ordering', () => {
  it('should emit EXECUTION_START first', async () => {
    const plan = {
      diagnosis: 'TEST',
      executionType: EXECUTION_TYPE.HOLD,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [NODE_TYPE.CONTINUE_MONITORING],
        edges: [],
      },
    };

    const result = await executeExecutionPlan(plan);

    expect(result.events[0].type).toBe(RUNTIME_EVENT.EXECUTION_START);
  });

  it('should emit EXECUTION_SUCCESS last', async () => {
    const plan = {
      diagnosis: 'TEST',
      executionType: EXECUTION_TYPE.HOLD,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [NODE_TYPE.CONTINUE_MONITORING],
        edges: [],
      },
    };

    const result = await executeExecutionPlan(plan);

    expect(result.events[result.events.length - 1].type).toBe(RUNTIME_EVENT.EXECUTION_SUCCESS);
  });

  it('should emit NODE_START before NODE_SUCCESS', async () => {
    const plan = {
      diagnosis: 'TEST',
      executionType: EXECUTION_TYPE.HOLD,
      priority: PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [NODE_TYPE.CONTINUE_MONITORING],
        edges: [],
      },
    };

    const result = await executeExecutionPlan(plan);

    const nodeEvents = result.events.filter(e => e.type.startsWith('NODE_'));
    const startIndex = nodeEvents.findIndex(e => e.type === RUNTIME_EVENT.NODE_START);
    const successIndex = nodeEvents.findIndex(e => e.type === RUNTIME_EVENT.NODE_SUCCESS);

    expect(startIndex).toBeLessThan(successIndex);
  });
});

// ============================================================
// ExecutionGraph
// ============================================================

describe('ExecutionGraph', () => {
  it('should build graph from nodes and edges', () => {
    const graph = new ExecutionGraph({
      nodes: [NODE_TYPE.GENERATE_HOOK_VARIANTS, NODE_TYPE.VALIDATE_HOOKS],
      edges: [{ from: NODE_TYPE.GENERATE_HOOK_VARIANTS, to: NODE_TYPE.VALIDATE_HOOKS }],
    });

    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
  });

  it('should perform topological sort', () => {
    const graph = new ExecutionGraph({
      nodes: [NODE_TYPE.VALIDATE_HOOKS, NODE_TYPE.GENERATE_HOOK_VARIANTS],
      edges: [{ from: NODE_TYPE.GENERATE_HOOK_VARIANTS, to: NODE_TYPE.VALIDATE_HOOKS }],
    });

    const sorted = graph.getSortedNodes();
    expect(sorted[0].type).toBe(NODE_TYPE.GENERATE_HOOK_VARIANTS);
    expect(sorted[1].type).toBe(NODE_TYPE.VALIDATE_HOOKS);
  });

  it('should detect cycles in graph', () => {
    expect(() => {
      new ExecutionGraph({
        nodes: ['A', 'B'],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'A' },
        ],
      });
    }).toThrow('cycle detected');
  });

  it('should track node dependencies', () => {
    const graph = new ExecutionGraph({
      nodes: [NODE_TYPE.GENERATE_HOOK_VARIANTS, NODE_TYPE.VALIDATE_HOOKS],
      edges: [{ from: NODE_TYPE.GENERATE_HOOK_VARIANTS, to: NODE_TYPE.VALIDATE_HOOKS }],
    });

    const sorted = graph.getSortedNodes();
    const deps = graph.getDependencies(sorted[1].id);

    expect(deps).toHaveLength(1);
    expect(deps[0].type).toBe(NODE_TYPE.GENERATE_HOOK_VARIANTS);
  });
});

// ============================================================
// Fixture Verification
// ============================================================

describe('RuntimeOrchestrator — fixture scenarios', () => {
  it.each(SCENARIOS)('$name: $description', async (scenario) => {
    const result = await executeExecutionPlan(scenario.plan);

    expect(result.status).toBe(scenario.expected.status);
    expect(result.executedNodes).toHaveLength(scenario.expected.nodeCount);
    expect(result.summary.successful).toBe(scenario.expected.successful);
    expect(result.summary.failed).toBe(scenario.expected.failed);
    expect(result.summary.skipped).toBe(scenario.expected.skipped);

    if (scenario.expected.executionOrder) {
      const actualOrder = result.executedNodes.map(n => n.nodeType);
      expect(actualOrder).toEqual(scenario.expected.executionOrder);
    }
  });
});

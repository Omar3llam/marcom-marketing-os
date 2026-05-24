// ============================================================
// ExecutionPlanner — test suite
// ============================================================
// Comprehensive verification of execution plan generation:
//   - Input validation (diagnosis, recommendations array, recommendation structure)
//   - Output shape (diagnosis, executionType, priority, graph)
//   - Single recommendation → correct execution type
//   - Multiple recommendations → merged graph
//   - Duplicate recommendations → collapsed
//   - Mixed priorities → highest wins
//   - HOLD_STEADY → HOLD plan
//   - Determinism (same input → same output)
//   - Order preservation (recommendation order preserved in graph)
//   - Fixture verification (all 10 canonical scenarios)
// ============================================================
import { describe, it, expect, vi } from 'vitest';

// Mock logger BEFORE imports
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { buildExecutionPlan }                   from './ExecutionPlanner.js';
import { REC_TYPE, PRIORITY }                   from '../recommendation-engine/index.js';
import { EXECUTION_TYPE, PLAN_PRIORITY, NODE_TYPE } from './planTypes.js';
import { SCENARIOS }                            from './fixtures/scenarios.js';

describe('ExecutionPlanner — input validation', () => {
  it('throws when input is null', () => {
    expect(() => buildExecutionPlan(null)).toThrow('input must be a non-null object');
  });

  it('throws when input is undefined', () => {
    expect(() => buildExecutionPlan(undefined)).toThrow('input must be a non-null object');
  });

  it('throws when input is not an object', () => {
    expect(() => buildExecutionPlan('invalid')).toThrow('input must be a non-null object');
  });

  it('throws when diagnosis is missing', () => {
    expect(() => buildExecutionPlan({ recommendations: [] })).toThrow('diagnosis must be a non-empty string');
  });

  it('throws when diagnosis is not a string', () => {
    expect(() => buildExecutionPlan({ diagnosis: 123, recommendations: [] })).toThrow('diagnosis must be a non-empty string');
  });

  it('throws when diagnosis is empty string', () => {
    expect(() => buildExecutionPlan({ diagnosis: '', recommendations: [] })).toThrow('diagnosis must be a non-empty string');
  });

  it('throws when recommendations is missing', () => {
    expect(() => buildExecutionPlan({ diagnosis: 'CREATIVE_FATIGUE' })).toThrow('recommendations must be an array');
  });

  it('throws when recommendations is not an array', () => {
    expect(() => buildExecutionPlan({ diagnosis: 'CREATIVE_FATIGUE', recommendations: 'invalid' })).toThrow('recommendations must be an array');
  });

  it('throws when recommendations array is empty', () => {
    expect(() => buildExecutionPlan({ diagnosis: 'CREATIVE_FATIGUE', recommendations: [] })).toThrow('recommendations array cannot be empty');
  });

  it('throws when recommendation is not an object', () => {
    expect(() => buildExecutionPlan({
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: ['invalid'],
    })).toThrow('recommendations[0] must be a non-null object');
  });

  it('throws when recommendation.type is missing', () => {
    expect(() => buildExecutionPlan({
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [{ priority: 'HIGH' }],
    })).toThrow('recommendations[0].type is required');
  });

  it('throws when recommendation.type is not a string', () => {
    expect(() => buildExecutionPlan({
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [{ type: 123, priority: 'HIGH' }],
    })).toThrow('recommendations[0].type is required');
  });

  it('throws when recommendation.type is empty', () => {
    expect(() => buildExecutionPlan({
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [{ type: '', priority: 'HIGH' }],
    })).toThrow('recommendations[0].type is required');
  });

  it('throws when recommendation.type is unknown', () => {
    expect(() => buildExecutionPlan({
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [{ type: 'UNKNOWN_TYPE', priority: 'HIGH' }],
    })).toThrow('unknown recommendation type "UNKNOWN_TYPE"');
  });

  it('throws when recommendation.priority is missing', () => {
    expect(() => buildExecutionPlan({
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [{ type: REC_TYPE.REFRESH_HOOK }],
    })).toThrow('recommendations[0].priority is required');
  });

  it('throws when recommendation.priority is not a string', () => {
    expect(() => buildExecutionPlan({
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [{ type: REC_TYPE.REFRESH_HOOK, priority: 123 }],
    })).toThrow('recommendations[0].priority is required');
  });
});

describe('ExecutionPlanner — output shape', () => {
  it('returns object with diagnosis, executionType, priority, graph', () => {
    const result = buildExecutionPlan({
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [
        { type: REC_TYPE.REFRESH_HOOK, priority: PRIORITY.HIGH, rationale: 'CTR dropped' },
      ],
    });

    expect(result).toHaveProperty('diagnosis');
    expect(result).toHaveProperty('executionType');
    expect(result).toHaveProperty('priority');
    expect(result).toHaveProperty('graph');
  });

  it('graph has nodes and edges arrays', () => {
    const result = buildExecutionPlan({
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [
        { type: REC_TYPE.REFRESH_HOOK, priority: PRIORITY.HIGH, rationale: 'CTR dropped' },
      ],
    });

    expect(result.graph).toHaveProperty('nodes');
    expect(result.graph).toHaveProperty('edges');
    expect(Array.isArray(result.graph.nodes)).toBe(true);
    expect(Array.isArray(result.graph.edges)).toBe(true);
  });

  it('diagnosis from input flows through to output', () => {
    const result = buildExecutionPlan({
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [
        { type: REC_TYPE.REFRESH_HOOK, priority: PRIORITY.HIGH, rationale: 'CTR dropped' },
      ],
    });

    expect(result.diagnosis).toBe('CREATIVE_FATIGUE');
  });
});

describe('ExecutionPlanner — single recommendation mapping', () => {
  it('REFRESH_HOOK → CONTENT_OPTIMIZATION', () => {
    const result = buildExecutionPlan({
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [
        { type: REC_TYPE.REFRESH_HOOK, priority: PRIORITY.HIGH, rationale: 'CTR dropped' },
      ],
    });

    expect(result.executionType).toBe(EXECUTION_TYPE.CONTENT_OPTIMIZATION);
    expect(result.priority).toBe(PLAN_PRIORITY.HIGH);
    expect(result.graph.nodes).toHaveLength(3);
    expect(result.graph.edges).toHaveLength(2);
  });

  it('ROTATE_CREATIVE → VISUAL_GENERATION', () => {
    const result = buildExecutionPlan({
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [
        { type: REC_TYPE.ROTATE_CREATIVE, priority: PRIORITY.HIGH, rationale: 'Overexposure' },
      ],
    });

    expect(result.executionType).toBe(EXECUTION_TYPE.VISUAL_GENERATION);
  });

  it('TEST_NEW_ANGLE → STRATEGY_EXPERIMENT', () => {
    const result = buildExecutionPlan({
      diagnosis: 'AUDIENCE_MISMATCH',
      recommendations: [
        { type: REC_TYPE.TEST_NEW_ANGLE, priority: PRIORITY.HIGH, rationale: 'Wrong audience' },
      ],
    });

    expect(result.executionType).toBe(EXECUTION_TYPE.STRATEGY_EXPERIMENT);
  });

  it('REDUCE_BUDGET → BUDGET_REALLOCATION', () => {
    const result = buildExecutionPlan({
      diagnosis: 'INEFFICIENT_SCALING',
      recommendations: [
        { type: REC_TYPE.REDUCE_BUDGET, priority: PRIORITY.HIGH, rationale: 'CPL too high' },
      ],
    });

    expect(result.executionType).toBe(EXECUTION_TYPE.BUDGET_REALLOCATION);
  });

  it('DUPLICATE_WINNER → SCALING_ACTION', () => {
    const result = buildExecutionPlan({
      diagnosis: 'HEALTHY',
      recommendations: [
        { type: REC_TYPE.DUPLICATE_WINNER, priority: PRIORITY.MEDIUM, rationale: 'High spend' },
      ],
    });

    expect(result.executionType).toBe(EXECUTION_TYPE.SCALING_ACTION);
  });

  it('HOLD_STEADY → HOLD', () => {
    const result = buildExecutionPlan({
      diagnosis: 'HEALTHY',
      recommendations: [
        { type: REC_TYPE.HOLD_STEADY, priority: PRIORITY.HIGH, rationale: 'All metrics healthy' },
      ],
    });

    expect(result.executionType).toBe(EXECUTION_TYPE.HOLD);
    expect(result.graph.nodes).toHaveLength(1);
    expect(result.graph.edges).toHaveLength(0);
  });
});

describe('ExecutionPlanner — multiple recommendations', () => {
  it('merges graphs from multiple recommendations', () => {
    const result = buildExecutionPlan({
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [
        { type: REC_TYPE.REFRESH_HOOK,    priority: PRIORITY.HIGH,   rationale: 'CTR dropped' },
        { type: REC_TYPE.ROTATE_CREATIVE, priority: PRIORITY.HIGH,   rationale: 'Overexposure' },
      ],
    });

    expect(result.graph.nodes.length).toBeGreaterThan(3); // more than single recommendation
    expect(result.graph.edges.length).toBeGreaterThan(2);
  });

  it('execution type from first recommendation when mixed types', () => {
    const result = buildExecutionPlan({
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [
        { type: REC_TYPE.REFRESH_HOOK,    priority: PRIORITY.HIGH,   rationale: 'CTR dropped' },
        { type: REC_TYPE.ROTATE_CREATIVE, priority: PRIORITY.HIGH,   rationale: 'Overexposure' },
      ],
    });

    expect(result.executionType).toBe(EXECUTION_TYPE.CONTENT_OPTIMIZATION);
  });

  it('same execution type preserved when all recommendations map to same type', () => {
    const result = buildExecutionPlan({
      diagnosis: 'HEALTHY',
      recommendations: [
        { type: REC_TYPE.DUPLICATE_WINNER, priority: PRIORITY.MEDIUM, rationale: 'High spend' },
        { type: REC_TYPE.DUPLICATE_WINNER, priority: PRIORITY.MEDIUM, rationale: 'High spend' },
      ],
    });

    expect(result.executionType).toBe(EXECUTION_TYPE.SCALING_ACTION);
  });
});

describe('ExecutionPlanner — duplicate recommendations', () => {
  it('collapses duplicate recommendation types', () => {
    const result = buildExecutionPlan({
      diagnosis: 'LOW_CTR',
      recommendations: [
        { type: REC_TYPE.REFRESH_HOOK, priority: PRIORITY.HIGH,   rationale: 'Weak hook' },
        { type: REC_TYPE.REFRESH_HOOK, priority: PRIORITY.HIGH,   rationale: 'Weak hook' },
        { type: REC_TYPE.TEST_NEW_ANGLE, priority: PRIORITY.MEDIUM, rationale: 'Test angle' },
      ],
    });

    // Should only have nodes from REFRESH_HOOK once + TEST_NEW_ANGLE
    expect(result.graph.nodes).toHaveLength(5); // 3 from REFRESH_HOOK + 2 from TEST_NEW_ANGLE
  });

  it('preserves order when deduplicating', () => {
    const result = buildExecutionPlan({
      diagnosis: 'LOW_CTR',
      recommendations: [
        { type: REC_TYPE.REFRESH_HOOK,   priority: PRIORITY.HIGH,   rationale: 'First' },
        { type: REC_TYPE.TEST_NEW_ANGLE, priority: PRIORITY.MEDIUM, rationale: 'Second' },
        { type: REC_TYPE.REFRESH_HOOK,   priority: PRIORITY.HIGH,   rationale: 'Third (duplicate)' },
      ],
    });

    // First 3 nodes should be from REFRESH_HOOK (first occurrence)
    expect(result.graph.nodes[0]).toBe(NODE_TYPE.GENERATE_HOOK_VARIANTS);
    expect(result.graph.nodes[1]).toBe(NODE_TYPE.VALIDATE_HOOKS);
    expect(result.graph.nodes[2]).toBe(NODE_TYPE.RANK_HOOKS);
  });
});

describe('ExecutionPlanner — priority determination', () => {
  it('HIGH priority recommendation → HIGH plan priority', () => {
    const result = buildExecutionPlan({
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [
        { type: REC_TYPE.REFRESH_HOOK, priority: PRIORITY.HIGH, rationale: 'CTR dropped' },
      ],
    });

    expect(result.priority).toBe(PLAN_PRIORITY.HIGH);
  });

  it('MEDIUM priority recommendation → MEDIUM plan priority', () => {
    const result = buildExecutionPlan({
      diagnosis: 'HEALTHY',
      recommendations: [
        { type: REC_TYPE.DUPLICATE_WINNER, priority: PRIORITY.MEDIUM, rationale: 'High spend' },
      ],
    });

    expect(result.priority).toBe(PLAN_PRIORITY.MEDIUM);
  });

  it('LOW priority recommendation → LOW plan priority', () => {
    const result = buildExecutionPlan({
      diagnosis: 'HEALTHY',
      recommendations: [
        { type: REC_TYPE.HOLD_STEADY, priority: PRIORITY.LOW, rationale: 'Monitor' },
      ],
    });

    expect(result.priority).toBe(PLAN_PRIORITY.LOW);
  });

  it('mixed priorities → highest priority wins', () => {
    const result = buildExecutionPlan({
      diagnosis: 'AUDIENCE_MISMATCH',
      recommendations: [
        { type: REC_TYPE.TEST_NEW_ANGLE,  priority: PRIORITY.HIGH,   rationale: 'Wrong audience' },
        { type: REC_TYPE.ROTATE_CREATIVE, priority: PRIORITY.MEDIUM, rationale: 'Creative issue' },
      ],
    });

    expect(result.priority).toBe(PLAN_PRIORITY.HIGH);
  });

  it('HIGH + MEDIUM + LOW → HIGH', () => {
    const result = buildExecutionPlan({
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [
        { type: REC_TYPE.REFRESH_HOOK,    priority: PRIORITY.HIGH,   rationale: 'CTR dropped' },
        { type: REC_TYPE.ROTATE_CREATIVE, priority: PRIORITY.MEDIUM, rationale: 'Overexposure' },
        { type: REC_TYPE.HOLD_STEADY,     priority: PRIORITY.LOW,    rationale: 'Monitor' },
      ],
    });

    expect(result.priority).toBe(PLAN_PRIORITY.HIGH);
  });
});

describe('ExecutionPlanner — determinism', () => {
  it('same input produces same output', () => {
    const input = {
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [
        { type: REC_TYPE.REFRESH_HOOK, priority: PRIORITY.HIGH, rationale: 'CTR dropped' },
      ],
    };

    const result1 = buildExecutionPlan(input);
    const result2 = buildExecutionPlan(input);

    expect(result1).toEqual(result2);
  });

  it('same input produces same node order', () => {
    const input = {
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [
        { type: REC_TYPE.REFRESH_HOOK,    priority: PRIORITY.HIGH, rationale: 'CTR dropped' },
        { type: REC_TYPE.ROTATE_CREATIVE, priority: PRIORITY.HIGH, rationale: 'Overexposure' },
      ],
    };

    const result1 = buildExecutionPlan(input);
    const result2 = buildExecutionPlan(input);

    expect(result1.graph.nodes).toEqual(result2.graph.nodes);
  });

  it('same input produces same edge order', () => {
    const input = {
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [
        { type: REC_TYPE.REFRESH_HOOK,    priority: PRIORITY.HIGH, rationale: 'CTR dropped' },
        { type: REC_TYPE.ROTATE_CREATIVE, priority: PRIORITY.HIGH, rationale: 'Overexposure' },
      ],
    };

    const result1 = buildExecutionPlan(input);
    const result2 = buildExecutionPlan(input);

    expect(result1.graph.edges).toEqual(result2.graph.edges);
  });
});

describe('ExecutionPlanner — order preservation', () => {
  it('preserves recommendation order in merged graph', () => {
    const result = buildExecutionPlan({
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [
        { type: REC_TYPE.REFRESH_HOOK,    priority: PRIORITY.HIGH, rationale: 'First' },
        { type: REC_TYPE.ROTATE_CREATIVE, priority: PRIORITY.HIGH, rationale: 'Second' },
      ],
    });

    // First 3 nodes should be from REFRESH_HOOK (first recommendation)
    expect(result.graph.nodes[0]).toBe(NODE_TYPE.GENERATE_HOOK_VARIANTS);
    expect(result.graph.nodes[1]).toBe(NODE_TYPE.VALIDATE_HOOKS);
    expect(result.graph.nodes[2]).toBe(NODE_TYPE.RANK_HOOKS);

    // Next 2 nodes should be from ROTATE_CREATIVE (second recommendation)
    expect(result.graph.nodes[3]).toBe(NODE_TYPE.GENERATE_VISUAL_BRIEF);
    expect(result.graph.nodes[4]).toBe(NODE_TYPE.GENERATE_CAPTION_VARIANTS);
  });

  it('reverse order produces different node sequence', () => {
    const result1 = buildExecutionPlan({
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [
        { type: REC_TYPE.REFRESH_HOOK,    priority: PRIORITY.HIGH, rationale: 'First' },
        { type: REC_TYPE.ROTATE_CREATIVE, priority: PRIORITY.HIGH, rationale: 'Second' },
      ],
    });

    const result2 = buildExecutionPlan({
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [
        { type: REC_TYPE.ROTATE_CREATIVE, priority: PRIORITY.HIGH, rationale: 'First' },
        { type: REC_TYPE.REFRESH_HOOK,    priority: PRIORITY.HIGH, rationale: 'Second' },
      ],
    });

    expect(result1.graph.nodes).not.toEqual(result2.graph.nodes);
    expect(result1.graph.nodes[0]).not.toBe(result2.graph.nodes[0]);
  });
});

describe('ExecutionPlanner — fixture verification', () => {
  it.each(SCENARIOS)('$name → $expected.executionType', ({ input, expected }) => {
    const result = buildExecutionPlan(input);

    expect(result.diagnosis).toBe(expected.diagnosis);
    expect(result.executionType).toBe(expected.executionType);
    expect(result.priority).toBe(expected.priority);
    expect(result.graph.nodes).toHaveLength(expected.nodeCount);
    expect(result.graph.edges).toHaveLength(expected.edgeCount);

    if (expected.nodes) {
      expect(result.graph.nodes).toEqual(expected.nodes);
    }

    if (expected.nodesStartWith) {
      for (let i = 0; i < expected.nodesStartWith.length; i++) {
        expect(result.graph.nodes[i]).toBe(expected.nodesStartWith[i]);
      }
    }
  });
});

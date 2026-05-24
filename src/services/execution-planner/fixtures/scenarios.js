// ============================================================
// Execution Planner — canonical evaluation harness
// ============================================================
// 10 frozen scenarios that define the execution planning contract.
// Every scenario must produce exactly the expected output
// for all future changes to remain valid.
//
// Run via ExecutionPlanner.test.js fixture verification suite.
// ============================================================
import { REC_TYPE, PRIORITY }                       from '../../recommendation-engine/index.js';
import { EXECUTION_TYPE, NODE_TYPE, PLAN_PRIORITY } from '../planTypes.js';

export const SCENARIOS = [
  // ── 1 ── single REFRESH_HOOK recommendation ───────────
  {
    name:        'single_refresh_hook',
    description: 'REFRESH_HOOK → CONTENT_OPTIMIZATION plan',
    input: {
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [
        { type: REC_TYPE.REFRESH_HOOK, priority: PRIORITY.HIGH, rationale: 'CTR dropped' },
      ],
    },
    expected: {
      diagnosis:     'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority:      PLAN_PRIORITY.HIGH,
      nodeCount:     3,
      nodes: [
        NODE_TYPE.GENERATE_HOOK_VARIANTS,
        NODE_TYPE.VALIDATE_HOOKS,
        NODE_TYPE.RANK_HOOKS,
      ],
      edgeCount: 2,
    },
  },

  // ── 2 ── multiple recommendations from CREATIVE_FATIGUE ──
  {
    name:        'creative_fatigue_full',
    description: 'CREATIVE_FATIGUE with 3 recommendations → merged graph',
    input: {
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [
        { type: REC_TYPE.REFRESH_HOOK,    priority: PRIORITY.HIGH,   rationale: 'CTR dropped' },
        { type: REC_TYPE.ROTATE_CREATIVE, priority: PRIORITY.HIGH,   rationale: 'Overexposure' },
        { type: REC_TYPE.TEST_NEW_ANGLE,  priority: PRIORITY.MEDIUM, rationale: 'Validate angle' },
      ],
    },
    expected: {
      diagnosis:     'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority:      PLAN_PRIORITY.HIGH,
      nodeCount:     7,
      edgeCount:     4,
    },
  },

  // ── 3 ── HOLD_STEADY → minimal plan ───────────────────
  {
    name:        'healthy_hold_steady',
    description: 'HEALTHY + HOLD_STEADY → HOLD plan',
    input: {
      diagnosis: 'HEALTHY',
      recommendations: [
        { type: REC_TYPE.HOLD_STEADY, priority: PRIORITY.HIGH, rationale: 'All metrics healthy' },
      ],
    },
    expected: {
      diagnosis:     'HEALTHY',
      executionType: EXECUTION_TYPE.HOLD,
      priority:      PLAN_PRIORITY.HIGH,
      nodeCount:     1,
      nodes:         [NODE_TYPE.CONTINUE_MONITORING],
      edgeCount:     0,
    },
  },

  // ── 4 ── DUPLICATE_WINNER + HOLD_STEADY ──────────────
  {
    name:        'healthy_duplicate_winner',
    description: 'HEALTHY high spend → SCALING_ACTION + HOLD',
    input: {
      diagnosis: 'HEALTHY',
      recommendations: [
        { type: REC_TYPE.DUPLICATE_WINNER, priority: PRIORITY.MEDIUM, rationale: 'High spend' },
        { type: REC_TYPE.HOLD_STEADY,      priority: PRIORITY.LOW,    rationale: 'Monitor' },
      ],
    },
    expected: {
      diagnosis:     'HEALTHY',
      executionType: EXECUTION_TYPE.SCALING_ACTION,
      priority:      PLAN_PRIORITY.MEDIUM,
      nodeCount:     3,
      edgeCount:     1,
    },
  },

  // ── 5 ── REDUCE_BUDGET alone ─────────────────────────
  {
    name:        'inefficient_scaling_reduce',
    description: 'INEFFICIENT_SCALING → BUDGET_REALLOCATION',
    input: {
      diagnosis: 'INEFFICIENT_SCALING',
      recommendations: [
        { type: REC_TYPE.REDUCE_BUDGET, priority: PRIORITY.HIGH, rationale: 'CPL too high' },
      ],
    },
    expected: {
      diagnosis:     'INEFFICIENT_SCALING',
      executionType: EXECUTION_TYPE.BUDGET_REALLOCATION,
      priority:      PLAN_PRIORITY.HIGH,
      nodeCount:     2,
      nodes: [
        NODE_TYPE.CALCULATE_OPTIMAL_BUDGET,
        NODE_TYPE.GENERATE_REALLOCATION_PLAN,
      ],
      edgeCount: 1,
    },
  },

  // ── 6 ── duplicate recommendations → collapsed ────────
  {
    name:        'duplicate_recommendations',
    description: 'Duplicate REFRESH_HOOK → deduplicated plan',
    input: {
      diagnosis: 'LOW_CTR',
      recommendations: [
        { type: REC_TYPE.REFRESH_HOOK,   priority: PRIORITY.HIGH,   rationale: 'Weak hook' },
        { type: REC_TYPE.REFRESH_HOOK,   priority: PRIORITY.HIGH,   rationale: 'Weak hook' },
        { type: REC_TYPE.TEST_NEW_ANGLE, priority: PRIORITY.MEDIUM, rationale: 'Test angle' },
      ],
    },
    expected: {
      diagnosis:     'LOW_CTR',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority:      PLAN_PRIORITY.HIGH,
      nodeCount:     5, // 3 from REFRESH_HOOK + 2 from TEST_NEW_ANGLE
      edgeCount:     3,
    },
  },

  // ── 7 ── mixed priorities → highest wins ─────────────
  {
    name:        'mixed_priority_handling',
    description: 'HIGH + MEDIUM → plan priority = HIGH',
    input: {
      diagnosis: 'AUDIENCE_MISMATCH',
      recommendations: [
        { type: REC_TYPE.TEST_NEW_ANGLE,  priority: PRIORITY.HIGH,   rationale: 'Wrong audience' },
        { type: REC_TYPE.ROTATE_CREATIVE, priority: PRIORITY.MEDIUM, rationale: 'Creative issue' },
      ],
    },
    expected: {
      diagnosis:     'AUDIENCE_MISMATCH',
      executionType: EXECUTION_TYPE.STRATEGY_EXPERIMENT,
      priority:      PLAN_PRIORITY.HIGH,
      nodeCount:     4,
      edgeCount:     2,
    },
  },

  // ── 8 ── determinism test ────────────────────────────
  {
    name:        'determinism_same_input',
    description: 'Same input → same output (deterministic)',
    input: {
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [
        { type: REC_TYPE.REFRESH_HOOK, priority: PRIORITY.HIGH, rationale: 'CTR dropped' },
      ],
    },
    expected: {
      diagnosis:     'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority:      PLAN_PRIORITY.HIGH,
      nodeCount:     3,
      nodes: [
        NODE_TYPE.GENERATE_HOOK_VARIANTS,
        NODE_TYPE.VALIDATE_HOOKS,
        NODE_TYPE.RANK_HOOKS,
      ],
      edgeCount: 2,
    },
  },

  // ── 9 ── order preservation test ─────────────────────
  {
    name:        'order_preservation',
    description: 'Recommendation order preserved in graph',
    input: {
      diagnosis: 'CREATIVE_FATIGUE',
      recommendations: [
        { type: REC_TYPE.REFRESH_HOOK,    priority: PRIORITY.HIGH, rationale: 'First' },
        { type: REC_TYPE.ROTATE_CREATIVE, priority: PRIORITY.HIGH, rationale: 'Second' },
      ],
    },
    expected: {
      diagnosis:     'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority:      PLAN_PRIORITY.HIGH,
      nodeCount:     5,
      nodesStartWith: [
        NODE_TYPE.GENERATE_HOOK_VARIANTS,
        NODE_TYPE.VALIDATE_HOOKS,
        NODE_TYPE.RANK_HOOKS,
      ],
      edgeCount: 3,
    },
  },

  // ── 10 ── AUDIENCE_MISMATCH standard ─────────────────
  {
    name:        'audience_mismatch_standard',
    description: 'AUDIENCE_MISMATCH → TEST_NEW_ANGLE + ROTATE_CREATIVE',
    input: {
      diagnosis: 'AUDIENCE_MISMATCH',
      recommendations: [
        { type: REC_TYPE.TEST_NEW_ANGLE,  priority: PRIORITY.HIGH,   rationale: 'Wrong audience' },
        { type: REC_TYPE.ROTATE_CREATIVE, priority: PRIORITY.MEDIUM, rationale: 'Creative not resonating' },
      ],
    },
    expected: {
      diagnosis:     'AUDIENCE_MISMATCH',
      executionType: EXECUTION_TYPE.STRATEGY_EXPERIMENT,
      priority:      PLAN_PRIORITY.HIGH,
      nodeCount:     4,
      edgeCount:     2,
    },
  },
];

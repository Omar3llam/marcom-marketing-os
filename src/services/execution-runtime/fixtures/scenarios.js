// ============================================================
// Runtime Orchestrator — canonical evaluation harness
// ============================================================
// 12 frozen scenarios that define the runtime execution contract.
// Every scenario must produce exactly the expected behavior
// for all future changes to remain valid.
//
// Run via RuntimeOrchestrator.test.js fixture verification suite.
// ============================================================
import { EXECUTION_TYPE, NODE_TYPE, PLAN_PRIORITY } from '../../execution-planner/index.js';
import { EXECUTION_STATUS, NODE_STATUS }            from '../runtimeEvents.js';

export const SCENARIOS = [
  // ── 1 ── empty graph → no-op success ───────────────────
  {
    name:        'empty_graph',
    description: 'Empty graph executes as no-op success',
    plan: {
      diagnosis:     'TEST_DIAGNOSIS',
      executionType: EXECUTION_TYPE.HOLD,
      priority:      PLAN_PRIORITY.LOW,
      graph: {
        nodes: [],
        edges: [],
      },
    },
    expected: {
      status: EXECUTION_STATUS.SUCCESS,
      nodeCount: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
    },
  },

  // ── 2 ── single node → linear execution ────────────────
  {
    name:        'single_node_success',
    description: 'Single node executes successfully',
    plan: {
      diagnosis:     'HEALTHY',
      executionType: EXECUTION_TYPE.HOLD,
      priority:      PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [NODE_TYPE.CONTINUE_MONITORING],
        edges: [],
      },
    },
    expected: {
      status: EXECUTION_STATUS.SUCCESS,
      nodeCount: 1,
      successful: 1,
      failed: 0,
      skipped: 0,
    },
  },

  // ── 3 ── linear graph (3 nodes) → ordered execution ────
  {
    name:        'linear_graph',
    description: 'Linear graph executes nodes in order',
    plan: {
      diagnosis:     'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority:      PLAN_PRIORITY.HIGH,
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
    },
    expected: {
      status: EXECUTION_STATUS.SUCCESS,
      nodeCount: 3,
      successful: 3,
      failed: 0,
      skipped: 0,
      executionOrder: [
        NODE_TYPE.GENERATE_HOOK_VARIANTS,
        NODE_TYPE.VALIDATE_HOOKS,
        NODE_TYPE.RANK_HOOKS,
      ],
    },
  },

  // ── 4 ── branching graph → deterministic traversal ─────
  {
    name:        'branching_graph',
    description: 'Branching graph executes all branches',
    plan: {
      diagnosis:     'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority:      PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [
          NODE_TYPE.GENERATE_HOOK_VARIANTS,
          NODE_TYPE.GENERATE_CAPTION_VARIANTS,
          NODE_TYPE.VALIDATE_HOOKS,
        ],
        edges: [],
      },
    },
    expected: {
      status: EXECUTION_STATUS.SUCCESS,
      nodeCount: 3,
      successful: 3,
      failed: 0,
      skipped: 0,
    },
  },

  // ── 5 ── parallel execution → independent nodes ────────
  {
    name:        'parallel_execution',
    description: 'Independent nodes execute in stable order',
    plan: {
      diagnosis:     'AUDIENCE_MISMATCH',
      executionType: EXECUTION_TYPE.STRATEGY_EXPERIMENT,
      priority:      PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [
          NODE_TYPE.GENERATE_AUDIENCE_HYPOTHESES,
          NODE_TYPE.GENERATE_ANGLE_VARIANTS,
        ],
        edges: [
          { from: NODE_TYPE.GENERATE_AUDIENCE_HYPOTHESES, to: NODE_TYPE.GENERATE_ANGLE_VARIANTS },
        ],
      },
    },
    expected: {
      status: EXECUTION_STATUS.SUCCESS,
      nodeCount: 2,
      successful: 2,
      failed: 0,
      skipped: 0,
    },
  },

  // ── 6 ── failed node → dependents skipped ──────────────
  {
    name:        'failed_node_propagation',
    description: 'Failed node causes dependents to be skipped',
    plan: {
      diagnosis:     'TEST_FAILURE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority:      PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [
          'UNKNOWN_NODE_TYPE',  // This will fail (no executor)
          NODE_TYPE.VALIDATE_HOOKS,
        ],
        edges: [
          { from: 'UNKNOWN_NODE_TYPE', to: NODE_TYPE.VALIDATE_HOOKS },
        ],
      },
    },
    expected: {
      status: EXECUTION_STATUS.FAILURE,
      nodeCount: 2,
      successful: 0,
      failed: 1,
      skipped: 1,
    },
  },

  // ── 7 ── partial success → mixed status ────────────────
  {
    name:        'partial_success',
    description: 'Some nodes succeed, some fail → PARTIAL_SUCCESS',
    plan: {
      diagnosis:     'TEST_PARTIAL',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority:      PLAN_PRIORITY.MEDIUM,
      graph: {
        nodes: [
          NODE_TYPE.GENERATE_HOOK_VARIANTS,
          'UNKNOWN_NODE_TYPE',
          NODE_TYPE.RANK_HOOKS,
        ],
        edges: [],
      },
    },
    expected: {
      status: EXECUTION_STATUS.PARTIAL_SUCCESS,
      nodeCount: 3,
      successful: 2,
      failed: 1,
      skipped: 0,
    },
  },

  // ── 8 ── complex graph → full traversal ────────────────
  {
    name:        'complex_graph',
    description: 'Complex graph with multiple paths',
    plan: {
      diagnosis:     'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority:      PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [
          NODE_TYPE.GENERATE_HOOK_VARIANTS,
          NODE_TYPE.GENERATE_VISUAL_BRIEF,
          NODE_TYPE.GENERATE_CAPTION_VARIANTS,
          NODE_TYPE.VALIDATE_HOOKS,
          NODE_TYPE.RANK_HOOKS,
        ],
        edges: [
          { from: NODE_TYPE.GENERATE_HOOK_VARIANTS, to: NODE_TYPE.VALIDATE_HOOKS },
          { from: NODE_TYPE.VALIDATE_HOOKS,         to: NODE_TYPE.RANK_HOOKS },
        ],
      },
    },
    expected: {
      status: EXECUTION_STATUS.SUCCESS,
      nodeCount: 5,
      successful: 5,
      failed: 0,
      skipped: 0,
    },
  },

  // ── 9 ── determinism test ───────────────────────────────
  {
    name:        'determinism_same_plan',
    description: 'Same plan → same execution order and events',
    plan: {
      diagnosis:     'CREATIVE_FATIGUE',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority:      PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [
          NODE_TYPE.GENERATE_HOOK_VARIANTS,
          NODE_TYPE.VALIDATE_HOOKS,
        ],
        edges: [
          { from: NODE_TYPE.GENERATE_HOOK_VARIANTS, to: NODE_TYPE.VALIDATE_HOOKS },
        ],
      },
    },
    expected: {
      status: EXECUTION_STATUS.SUCCESS,
      nodeCount: 2,
      successful: 2,
      failed: 0,
      skipped: 0,
      executionOrder: [
        NODE_TYPE.GENERATE_HOOK_VARIANTS,
        NODE_TYPE.VALIDATE_HOOKS,
      ],
    },
  },

  // ── 10 ── duplicate node types → all executed ──────────
  {
    name:        'duplicate_node_types',
    description: 'Duplicate node types execute independently',
    plan: {
      diagnosis:     'LOW_CTR',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority:      PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [
          NODE_TYPE.GENERATE_HOOK_VARIANTS,
          NODE_TYPE.GENERATE_HOOK_VARIANTS,
        ],
        edges: [],
      },
    },
    expected: {
      status: EXECUTION_STATUS.SUCCESS,
      nodeCount: 2,
      successful: 2,
      failed: 0,
      skipped: 0,
    },
  },

  // ── 11 ── all nodes skipped → FAILURE ───────────────────
  {
    name:        'all_nodes_skipped',
    description: 'All nodes skipped → overall FAILURE',
    plan: {
      diagnosis:     'TEST_SKIP',
      executionType: EXECUTION_TYPE.CONTENT_OPTIMIZATION,
      priority:      PLAN_PRIORITY.LOW,
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
    },
    expected: {
      status: EXECUTION_STATUS.FAILURE,
      nodeCount: 3,
      successful: 0,
      failed: 1,
      skipped: 2,
    },
  },

  // ── 12 ── HOLD_STEADY minimal plan ─────────────────────
  {
    name:        'hold_steady_minimal',
    description: 'HOLD_STEADY executes as single noop node',
    plan: {
      diagnosis:     'HEALTHY',
      executionType: EXECUTION_TYPE.HOLD,
      priority:      PLAN_PRIORITY.HIGH,
      graph: {
        nodes: [NODE_TYPE.CONTINUE_MONITORING],
        edges: [],
      },
    },
    expected: {
      status: EXECUTION_STATUS.SUCCESS,
      nodeCount: 1,
      successful: 1,
      failed: 0,
      skipped: 0,
    },
  },
];

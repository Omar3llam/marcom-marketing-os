// ============================================================
// Execution Planner — plan type definitions
// ============================================================
// Frozen enums that define execution plan vocabulary.
// Used by ExecutionPlanner to classify and structure plans.
// ============================================================

export const EXECUTION_TYPE = Object.freeze({
  CONTENT_OPTIMIZATION:  'CONTENT_OPTIMIZATION',
  VISUAL_GENERATION:     'VISUAL_GENERATION',
  STRATEGY_EXPERIMENT:   'STRATEGY_EXPERIMENT',
  BUDGET_REALLOCATION:   'BUDGET_REALLOCATION',
  SCALING_ACTION:        'SCALING_ACTION',
  HOLD:                  'HOLD',
});

export const PLAN_PRIORITY = Object.freeze({
  HIGH:   'HIGH',
  MEDIUM: 'MEDIUM',
  LOW:    'LOW',
});

export const NODE_TYPE = Object.freeze({
  // Content optimization nodes
  GENERATE_HOOK_VARIANTS: 'generate_hook_variants',
  VALIDATE_HOOKS:         'validate_hooks',
  RANK_HOOKS:             'rank_hooks',

  // Visual generation nodes
  GENERATE_VISUAL_BRIEF:    'generate_visual_brief',
  GENERATE_CAPTION_VARIANTS: 'generate_caption_variants',

  // Strategy experiment nodes
  GENERATE_AUDIENCE_HYPOTHESES: 'generate_audience_hypotheses',
  GENERATE_ANGLE_VARIANTS:      'generate_angle_variants',

  // Budget reallocation nodes
  CALCULATE_OPTIMAL_BUDGET:     'calculate_optimal_budget',
  GENERATE_REALLOCATION_PLAN:   'generate_reallocation_plan',

  // Scaling nodes
  IDENTIFY_WINNING_ATTRIBUTES: 'identify_winning_attributes',
  GENERATE_DUPLICATION_PLAN:   'generate_duplication_plan',

  // Hold nodes
  CONTINUE_MONITORING: 'continue_monitoring',
});

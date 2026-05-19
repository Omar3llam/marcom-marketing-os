/**
 * Decision FSM (Phase 11)
 *
 * Export barrel for state machine components.
 */

// Machine definition
export { decisionMachine } from './decisionMachine';
export type { DecisionContext, DecisionEvent } from './decisionMachine';

// Guards
export * from './guards';

// Actions
export * from './actions';

// Services
export * from './services';

// React hook
export { useDecisionMachine, useSimplifiedDecisionFlow } from './useDecisionMachine';
export type { UseDecisionMachineResult } from './useDecisionMachine';

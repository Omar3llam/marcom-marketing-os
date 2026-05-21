// ============================================================
// @marcom/runtime-contracts · TransitionActor
// ============================================================
// Identifies who/what drove a state transition. Used for audit
// logging + telemetry.
//
// IMPORTANT: Values must match Prisma TransitionActor enum exactly
// (see prisma/schema.prisma).
// ============================================================

export const TransitionActor = Object.freeze({
  WORKER:          'WORKER',          // BullMQ worker executing job
  TIMEOUT_HANDLER: 'TIMEOUT_HANDLER', // Automatic timeout daemon
  USER:            'USER',            // Direct user action (cancel)
  API:             'API',             // REST API endpoint
  RECONCILIATION:  'RECONCILIATION',  // Frontend reconciliation after disconnect
  RETRY_POLICY:    'RETRY_POLICY',    // Automatic / manual retry
  SUPERVISOR:      'SUPERVISOR',      // Supervisor process arbitrating collisions
  SYSTEM:          'SYSTEM',          // Internal system transition
});

const ACTOR_VALUES = Object.values(TransitionActor);

export function isValidActor(actor) {
  return ACTOR_VALUES.includes(actor);
}

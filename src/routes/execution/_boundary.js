// ============================================================
// Execution Engine Boundary — access control contract
// ============================================================
// Single source of truth for WHO may perform which execution
// operations. The HTTP-level enforcement is handled by
// firebaseAuthMiddleware + requireWorkspace + requireCollabRole at the
// /api/execute mount (server.js).
//
// R11 (E9): this comment previously named contextGuard, which is mounted
// nowhere in the codebase. Documentation is part of the security model — a
// reader auditing this path would have gone looking for a control that has
// never run.
// This module makes the rules explicit and importable so they
// can be referenced in guards, tests, and documentation.
//
// ── Writer endpoints (POST — mutate execution state) ────────
//   POST /execution/meta          user-initiated action request
//   POST /execution/:id/retry     user-initiated retry
//
// ── Reader endpoints (GET — read-only) ──────────────────────
//   GET /execution/audit          workspace audit trail
//   GET /execution/vitals         system health metrics
//   GET /execution/active         active in-flight list
//   GET /execution/:id/active     single-execution reconciliation
//   GET /execution/:id/transitions transition history
//   GET /execution/:id/incident   incident report
//
// ── Internal actors (BullMQ workers — bypass HTTP) ──────────
//   syncWorker       — reads campaigns, writes Action rows via prisma
//   (R7 retired temporalObserver, which read Actions and wrote DecisionMemory
//    + CampaignState. Its DecisionMemory query named columns that table does
//    not have, and it shared a Promise.all with the CampaignState read, so the
//    sweep could never write either one.)
//   The worker may not call the HTTP execution routes.
//   It may not update Action.status directly;
//   all status transitions go through ExecutionLifecycleService.
//
// ── Cross-cutting rules ──────────────────────────────────────
//   1. No direct prisma.action.update() outside agents/ or routes/execution/
//   2. Retries must flow through POST /:id/retry, not direct DB writes
//   3. All status transitions must be logged via ExecutionLifecycleService
// ============================================================

export const EXECUTION_WRITERS  = /** @type {const} */ (['user-request']);
export const EXECUTION_READERS  = /** @type {const} */ (['user-request', 'internal-worker']);
export const INTERNAL_ACTORS    = /** @type {const} */ (['syncWorker']);

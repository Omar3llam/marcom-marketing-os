// ============================================================
// MARCOM / Lumi — Quick Action handler (HMAC-signed links)
// POST /api/lumi/quick-action
// ============================================================
// R13-D / B3-C — RETIRED, for the same reason as rollback.js: it enqueued onto
// the legacy `actions` queue, and the worker draining that queue dispatched
// through stub executors that returned `{ ok: true }` without calling any ad
// platform. A signed link therefore reported "enqueued" for a mutation that
// would be marked EXECUTED_SUCCESS having done nothing.
//
// It was unreachable twice over:
//
//   * `signQuickAction` — the minting half of this flow — has no production
//     caller. utils/hmac.js says so in its own comment. No token, no entry.
//   * it required an existing PENDING Action row, and nothing in the repository
//     ever created one (the sole `action.create` was rollback's inverse).
//
// So there is no working behaviour to migrate. A signed one-click link that
// executes a real Meta mutation is a legitimate feature, but building it means
// minting tokens bound to a Decision and posting to the canonical producer —
// new work on the canonical path, not a move of anything that exists here.
// Recorded as remaining backend debt.
//
// The route stays mounted so an old link receives an explicit, machine-readable
// refusal rather than a 404. The HMAC verification stays in front of it: an
// unsigned or forged token must still be rejected as forged, and must not be
// able to learn anything from the retirement notice that a valid one would not.
// ============================================================
import { Router }            from 'express';
import { verifyQuickAction } from '../../utils/hmac.js';
import { logger }            from '../../utils/logger.js';
import { LEGACY_RETIRED_CODE } from './rollback.js';

export const quickActionRouter = Router();

// ─────────────────────────────────────────────────────────────
export async function quickActionHandler(req, res) {
  const { token, sig } = req.body || {};

  // Signature first. This endpoint is unauthenticated by design — the signature
  // IS the authorization — so verifying before answering keeps a forged token
  // from probing the endpoint at all.
  const v = verifyQuickAction({ token, sig });
  if (!v.ok) {
    return res.status(401).json({ error: 'InvalidQuickAction', reason: v.reason });
  }

  logger.warn(
    { actionId: v.actionId, workspaceId: v.workspaceId, actorId: v.actorId, scope: v.scope },
    '[lumi/quick-action] refused — legacy Action execution substrate is retired',
  );

  // NOTHING IS READ OR WRITTEN. No Action lookup, no status change, no enqueue.
  // `enqueued: false` is stated explicitly because the previous response said
  // `enqueued: true`, and a client that kept reading that field must not see a
  // stale truthy value.
  return res.status(501).json({
    error:   'QuickActionUnsupported',
    code:    LEGACY_RETIRED_CODE,
    message:
      'Quick actions ran on the legacy Action substrate, which performed no real '
      + 'platform mutation and has been retired. Nothing was changed on your ad account.',
    enqueued: false,
  });
}

quickActionRouter.post('/', quickActionHandler);

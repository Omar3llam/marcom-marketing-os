// ============================================================
// resolveActorId — the caller as the AUDIT COLUMNS mean it
// ============================================================
// Moved here verbatim by C-18 from `lumi/memory.js`, where C-05 wrote it. Not
// re-implemented and not generalised: three identical private copies is not
// "reuse exactly", it is the drift risk this repository already records six
// times over in its name collisions, seeded deliberately.
//
// ── THE DEFECT IT ANSWERS ───────────────────────────────────────────────────
//
// `req.userId` is `decodedToken.uid` — a Firebase identifier. Every actor column
// on the collaboration path is `@db.Uuid`, and `ApprovalRequest.requestedById`
// is NOT NULL. Writing the one into the other does not produce a wrong name; it
// produces a failed insert:
//
//   POST /api/lumi/approvals
//     → requestApproval() opens a transaction
//     → plan.update{ requiresApproval: true }         rolled back
//     → approvalRequest.create{ requestedById: uid }   22P02 invalid uuid
//     → 500
//
// C-05 fixed its own routes and left `lumi/collaboration.js` on the raw uid, so
// `Plan.requiresApproval` could never become true through the product — and
// `isPromotionApprovalBlocked`, five unit tests and correct in every one, had
// nothing to block. C-18 needed that gate to work, which is how a cleanup became
// part of a correctness slice.
//
// R-13 requires the trail to prove WHO. An unresolvable actor is therefore a
// refusal at the call site, never a null in the actor column.
// ============================================================
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';

/**
 * @param {import('express').Request} req
 * @returns {Promise<string|null>} a `User.id` uuid, or null when the caller
 *   cannot be resolved to a row. Callers answer 409 on null.
 */
export async function resolveActorId(req) {
  if (!req.userId) return null;
  try {
    const u = await prisma.user.findUnique({ where: { clerkId: req.userId }, select: { id: true } });
    return u?.id ?? null;
  } catch (err) {
    logger.error({ err: err.message, userId: req.userId }, '[lumi] actor resolution failed');
    return null;
  }
}

// No shared refusal helper on purpose. Each call site already answers 409
// `ActorUnresolved` with a sentence naming the seat it could not identify —
// "the requesting seat", "the deciding seat" — and collapsing those into one
// generic message would trade a small duplication for a worse answer. What had
// to be shared was the resolution, which is where the defect was.

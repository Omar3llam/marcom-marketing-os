// ============================================================
// MARCOM / Lumi — User Account Management Routes
// ============================================================
// Protected endpoints for user profile, workspace, and account deletion.
// All routes require Firebase JWT authentication via requireAuth middleware.
// ============================================================
import { Router } from 'express';
import { requireFirebaseAdminReady } from '../utils/firebaseAdmin.js';
import { logger } from '../utils/logger.js';
import { prisma } from '../lib/prisma.js';
import { requireCollabRole } from '../middleware/requireCollabRole.js';
import { workspaceColumnsFromContext } from './campaigns/context.js';
// R11 (F15): marcom_credentials has no FK to workspaces, so it does not cascade.
import { deleteWorkspaceCredentials } from '../services/connectors/credentialStore.js';

const getAuth = () => requireFirebaseAdminReady().auth();
// NOTE: This project uses Prisma/PostgreSQL — do NOT add admin.firestore() here.
// Firestore is not initialised and will throw on any .collection() call.

export const userRouter = Router();

// ══════════════════════════════════════════════════════════════
// GET /api/user/workspace — Fetch user's workspace
// ══════════════════════════════════════════════════════════════
/**
 * Fetch the workspace owned by the current user.
 * Returns workspace metadata (id, name, slug) for the sidebar dropdown.
 *
 * Response: {
 *   workspace: { id, name, slug, ownerId, createdAt, updatedAt } | null,
 *   hasWorkspace: boolean
 * }
 */
userRouter.get('/workspace', async (req, res) => {
  // NOTE: This project uses Prisma/PostgreSQL — NOT Firestore.
  // Firebase UID is stored in the clerkId column (legacy naming).
  try {
    const uid = req.user?.uid;

    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Look up user + their workspace via Prisma. `context` carries the onboarding
    // profile (name, market, industry, …); we surface `industry` + `market` on the
    // workspace response (Campaigns tailors revenue guidance by industry; the
    // Sidebar shows the market — neither has its own Workspace column).
    const user = await prisma.user.findFirst({
      where: { clerkId: uid },
      select: { id: true, workspaceId: true, email: true, context: true },
    });

    if (!user) {
      // User has a valid Firebase token but no Prisma row yet.
      // This happens before onboarding completes (firebaseAuthMiddleware
      // auto-provisions the row, but it may not have run yet for this
      // request path). Return hasWorkspace:false so the client knows to
      // redirect to onboarding rather than treating this as an error.
      return res.json({ workspace: null, hasWorkspace: false });
    }

    if (!user.workspaceId) {
      return res.json({ workspace: null, hasWorkspace: false });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: user.workspaceId },
      select: { id: true, name: true, currency: true, createdAt: true, spendTier: true, objective: true, adChannels: true, plan: true },
    });

    if (!workspace) {
      return res.json({ workspace: null, hasWorkspace: false });
    }

    // Onboarding prefs now live on real columns; fall back to the context blob
    // for accounts onboarded BEFORE the columns were populated (no regression).
    const ctxPrefs = workspaceColumnsFromContext(user.context);

    return res.json({
      workspace: {
        id:         workspace.id,
        name:       workspace.name,
        ownerId:    uid,
        createdAt:  workspace.createdAt,
        currency:   workspace.currency ?? 'USD',      // the account currency the FE formats money in (Meta sync corrects it)
        plan:       workspace.plan ?? 'FREE',          // feature-gating entitlement (FREE|GROWTH|PRO); drives usePlan/PlanGate in the client
        industry:   user.context?.industry ?? null,   // from onboarding; null until set (no regression for older accounts)
        market:     user.context?.market ?? null,     // onboarding market id (eg/sa/…); context-only, no Workspace column — the Sidebar reads it (else falls back to 'EG')
        spendTier:  workspace.spendTier ?? ctxPrefs.spendTier,
        objective:  workspace.objective ?? ctxPrefs.objective,
        // Stored onboarding preference only — NOT used for service routing. The
        // real channel scope is driven by OAuth/Integration rows (a connected
        // account), not this list. No service or client reads it (audit 2026-07).
        adChannels: workspace.adChannels?.length ? workspace.adChannels : ctxPrefs.adChannels,
      },
      hasWorkspace: true,
    });

  } catch (err) {
    logger.error({
      uid: req.user?.uid,
      code: err.code,
      message: err.message,
    }, '[userRouter] GET /workspace error');
    return res.status(500).json({
      error:  'Failed to fetch workspace',
      detail: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});

// ══════════════════════════════════════════════════════════════
// PATCH /api/user/profile — Update user display name
// ══════════════════════════════════════════════════════════════
/**
 * Update Firebase Auth displayName + Firestore user doc.
 * Email is immutable (managed by Firebase).
 *
 * Body: { displayName: string }
 * Response: { success: true, displayName: string }
 */
userRouter.patch('/profile', async (req, res) => {
  try {
    const { displayName } = req.body;
    const uid = req.user?.uid;

    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
      return res.status(400).json({ error: 'displayName is required' });
    }

    const trimmed = displayName.trim();

    if (trimmed.length > 100) {
      return res.status(400).json({ error: 'displayName too long (max 100 chars)' });
    }

    // Update Firebase Auth display name (source of truth for auth)
    await getAuth().updateUser(uid, { displayName: trimmed });

    // Prisma doesn't store displayName separately — Firebase Auth is the source.
    // Log and return success; the client reads displayName from the Firebase token.
    logger.info('[userRouter] Profile updated:', { uid, displayName: trimmed });

    res.json({ success: true, displayName: trimmed });
  } catch (err) {
    logger.error({ err: err.message }, '[userRouter] PATCH /profile error');
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ══════════════════════════════════════════════════════════════
// PATCH /api/user/workspace — Update workspace name
// ══════════════════════════════════════════════════════════════
/**
 * Update the workspace name.
 * Workspace slug is immutable (used in API tokens).
 *
 * STRATEGIST-only: the workspace is shared (Team & Roles), so BUYER/CLIENT
 * members must not rename it for everyone. Null collabRole ⇒ STRATEGIST
 * (seats predating Phase 8 are never locked out).
 *
 * Body: { workspaceName: string }
 * Response: { success: true, workspaceName: string }
 */
userRouter.patch('/workspace', requireCollabRole('STRATEGIST'), async (req, res) => {
  try {
    const { workspaceName } = req.body;
    const uid = req.user?.uid;

    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!workspaceName || typeof workspaceName !== 'string' || workspaceName.trim().length === 0) {
      return res.status(400).json({ error: 'workspaceName is required' });
    }

    const trimmed = workspaceName.trim();

    if (trimmed.length > 100) {
      return res.status(400).json({ error: 'workspaceName too long (max 100 chars)' });
    }

    // Look up the user's workspace via Prisma (not Firestore)
    const user = await prisma.user.findFirst({
      where: { clerkId: uid },
      select: { workspaceId: true },
    });

    if (!user?.workspaceId) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    await prisma.workspace.update({
      where: { id: user.workspaceId },
      data:  { name: trimmed },
    });

    logger.info('[userRouter] Workspace updated:', { uid, workspaceId: user.workspaceId, workspaceName: trimmed });

    res.json({ success: true, workspaceName: trimmed });
  } catch (err) {
    logger.error({ err: err.message }, '[userRouter] PATCH /workspace error');
    res.status(500).json({ error: 'Failed to update workspace' });
  }
});

// ══════════════════════════════════════════════════════════════
// DELETE /api/user/account — Delete user account permanently
// ══════════════════════════════════════════════════════════════
/**
 * DANGER ZONE: Permanently delete the user account.
 *
 * Since Team & Roles, invited members JOIN the host workspace — so the old
 * unconditional workspace cascade would let ANY member (even an invited
 * CLIENT) destroy the shared workspace for everyone. Three paths now:
 *
 *   1. SOLE member         → delete workspace (CASCADE removes all data)
 *   2. Non-last member     → delete ONLY this User row (OAuthTokens cascade
 *                            via the userId FK); workspace + teammates intact
 *   3. Last strategist     → 409 LastStrategist — transfer the role first
 *                            (effective role: null collabRole ⇒ STRATEGIST,
 *                            mirroring countEffectiveStrategists in team/index.js)
 *
 * The Firebase Auth user is deleted afterwards in paths 1–2 (invalidates all
 * tokens). AuditLog.userId is a bare column (no FK) — audit history survives.
 *
 * Response: { success: true }
 */
userRouter.delete('/account', async (req, res) => {
  try {
    const uid = req.user?.uid;

    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    logger.warn('[userRouter] DELETE /account initiated:', { uid });

    // ✅ Step 1: Find user in Prisma by Firebase UID
    // Firebase UID is stored in clerkId column (legacy name from Clerk → Firebase migration)
    const user = await prisma.user.findFirst({
      where: { clerkId: uid },
      select: { id: true, workspaceId: true, email: true },
    });

    if (!user) {
      logger.info('[userRouter] User not found in Prisma — attempting Firebase Auth cleanup only');
      // User might be in Firebase Auth but not in database
      try {
        await getAuth().deleteUser(uid);
        logger.info('[userRouter] Firebase Auth user deleted (no Prisma record)');
      } catch (authErr) {
        if (authErr.code === 'auth/user-not-found') {
          logger.info('[userRouter] Firebase Auth user already deleted');
          return res.json({ success: true });
        }
        throw authErr;
      }
      return res.json({ success: true });
    }

    const { workspaceId, email } = user;

    logger.info('[userRouter] Deleting account:', {
      uid,
      userId: user.id,
      workspaceId,
      email
    });

    // ✅ Step 2: Delete workspace ONLY when the caller is its sole member.
    // Prisma schema has onDelete: Cascade for:
    //   - users, actions, campaignStates, decisionMemory, auditLogs
    if (workspaceId) {
      const memberCount = await prisma.user.count({ where: { workspaceId } });

      if (memberCount === 1) {
        // R11 (F15) — purge the credential vault BEFORE the cascade.
        //
        // `marcom_credentials` is a raw-SQL table with NO foreign key to
        // workspaces, so Prisma's onDelete: Cascade does not reach it. This
        // handler's own docblock claimed the account deletion removed OAuth
        // tokens; it did not, and a deleted account left live encrypted Meta
        // and Google tokens behind indefinitely. The ADMIN delete path already
        // called this helper and documented exactly this reason — the
        // self-serve path simply never did.
        //
        // Ordered before the workspace delete so a failure here refuses the
        // whole deletion rather than orphaning the credentials it was meant to
        // remove.
        const credentialsDeleted = await deleteWorkspaceCredentials(workspaceId);

        await prisma.workspace.delete({
          where: { id: workspaceId },
        });
        logger.info('[userRouter] Workspace deleted (sole member, with CASCADE):', { workspaceId, credentialsDeleted });
      } else {
        // Multi-member workspace: never cascade it away on a member's account
        // deletion. Guard the roster first — the workspace must not be left
        // without a strategist (null collabRole ⇒ STRATEGIST, same effective-
        // role rule as countEffectiveStrategists in routes/team/index.js).
        const otherStrategists = await prisma.user.count({
          where: {
            workspaceId,
            id: { not: user.id },
            OR: [{ collabRole: 'STRATEGIST' }, { collabRole: null }],
          },
        });

        if (otherStrategists === 0) {
          return res.status(409).json({
            error: 'LastStrategist',
            message: 'You are the last strategist in this workspace. Transfer the strategist role to another member before deleting your account.',
          });
        }

        // Delete ONLY this member. OAuthToken rows cascade via the userId FK;
        // the workspace and every other member's data stay intact.
        await prisma.user.delete({ where: { id: user.id } });
        logger.info('[userRouter] User deleted (multi-member workspace kept):', {
          userId: user.id, workspaceId, memberCount,
        });
      }
    } else {
      // No workspace — delete user record directly
      await prisma.user.delete({
        where: { id: user.id },
      });
      logger.info('[userRouter] User deleted (no workspace):', { userId: user.id });
    }

    // ✅ Step 3: Delete Firebase Auth user LAST
    // This invalidates all tokens, so do it after database cleanup
    try {
      await getAuth().deleteUser(uid);
      logger.info('[userRouter] Firebase Auth user deleted:', { uid });
    } catch (authErr) {
      // If auth user already deleted, treat as success (idempotent)
      if (authErr.code === 'auth/user-not-found') {
        logger.info('[userRouter] Firebase Auth user already deleted');
      } else {
        // Auth deletion failed but database already cleaned up
        // Log error but still return success (database is source of truth)
        logger.error({
          code: authErr.code,
          message: authErr.message,
        }, '[userRouter] Firebase Auth deletion failed (DB already clean)');
      }
    }

    logger.warn('[userRouter] Account deletion complete:', {
      uid,
      email,
      workspaceId
    });

    res.json({ success: true });

  } catch (err) {
    logger.error({
      uid: req.user?.uid,
      code: err.code,
      message: err.message,
      stack: err.stack,
    }, '[userRouter] DELETE /account error');

    // Check if this is a "record not found" error (user already deleted)
    if (err.code === 'P2025') {
      logger.info('[userRouter] Record already deleted — treating as success');
      // Attempt Firebase Auth cleanup
      try {
        await getAuth().deleteUser(req.user?.uid);
      } catch {
        // Ignore errors
      }
      return res.json({ success: true });
    }

    res.status(500).json({
      error: 'Failed to delete account',
      hint: 'Contact support if this persists',
    });
  }
});

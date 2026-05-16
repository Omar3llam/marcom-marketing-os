// ============================================================
// MARCOM / Lumi — User Account Management Routes
// ============================================================
// Protected endpoints for user profile, workspace, and account deletion.
// All routes require Firebase JWT authentication via requireAuth middleware.
// ============================================================
import { Router } from 'express';
import admin from '../utils/firebaseAdmin.js';
import { logger } from '../utils/logger.js';
import { prisma } from '../lib/prisma.js';

const auth = admin.auth();
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

    // Look up user + their workspace via Prisma
    const user = await prisma.user.findFirst({
      where: { clerkId: uid },
      select: { id: true, workspaceId: true, email: true },
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
      select: { id: true, name: true, createdAt: true },
    });

    if (!workspace) {
      return res.json({ workspace: null, hasWorkspace: false });
    }

    return res.json({
      workspace: {
        id:        workspace.id,
        name:      workspace.name,
        ownerId:   uid,
        createdAt: workspace.createdAt,
      },
      hasWorkspace: true,
    });

  } catch (err) {
    logger.error('[userRouter] GET /workspace error:', {
      uid: req.user?.uid,
      code: err.code,
      message: err.message,
    });
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
    await auth.updateUser(uid, { displayName: trimmed });

    // Prisma doesn't store displayName separately — Firebase Auth is the source.
    // Log and return success; the client reads displayName from the Firebase token.
    logger.info('[userRouter] Profile updated:', { uid, displayName: trimmed });

    res.json({ success: true, displayName: trimmed });
  } catch (err) {
    logger.error('[userRouter] PATCH /profile error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ══════════════════════════════════════════════════════════════
// PATCH /api/user/workspace — Update workspace name
// ══════════════════════════════════════════════════════════════
/**
 * Update Firestore workspace name.
 * Workspace slug is immutable (used in API tokens).
 *
 * Body: { workspaceName: string }
 * Response: { success: true, workspaceName: string }
 */
userRouter.patch('/workspace', async (req, res) => {
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
    logger.error('[userRouter] PATCH /workspace error:', err);
    res.status(500).json({ error: 'Failed to update workspace' });
  }
});

// ══════════════════════════════════════════════════════════════
// DELETE /api/user/account — Delete user account permanently
// ══════════════════════════════════════════════════════════════
/**
 * DANGER ZONE: Permanently delete user account, workspace, and all data.
 *
 * Architecture:
 *   - Uses Prisma/PostgreSQL (NOT Firestore)
 *   - Deletes workspace → CASCADE deletes all related data:
 *     * Users, Actions, CampaignStates, DecisionMemory, Integrations, AuditLogs
 *   - Deletes Firebase Auth user to invalidate tokens
 *
 * Steps:
 *   1. Find user in Prisma by Firebase UID (stored in clerkId)
 *   2. Delete workspace (CASCADE handles all related data)
 *   3. Delete Firebase Auth user (invalidates all tokens)
 *   4. Client signs out and clears localStorage
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
        await auth.deleteUser(uid);
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

    // ✅ Step 2: Delete workspace (CASCADE deletes all related data)
    // Prisma schema has onDelete: Cascade for:
    //   - users, actions, campaignStates, decisionMemory, integrations, auditLogs
    if (workspaceId) {
      await prisma.workspace.delete({
        where: { id: workspaceId },
      });
      logger.info('[userRouter] Workspace deleted (with CASCADE):', { workspaceId });
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
      await auth.deleteUser(uid);
      logger.info('[userRouter] Firebase Auth user deleted:', { uid });
    } catch (authErr) {
      // If auth user already deleted, treat as success (idempotent)
      if (authErr.code === 'auth/user-not-found') {
        logger.info('[userRouter] Firebase Auth user already deleted');
      } else {
        // Auth deletion failed but database already cleaned up
        // Log error but still return success (database is source of truth)
        logger.error('[userRouter] Firebase Auth deletion failed (DB already clean):', {
          code: authErr.code,
          message: authErr.message,
        });
      }
    }

    logger.warn('[userRouter] Account deletion complete:', {
      uid,
      email,
      workspaceId
    });

    res.json({ success: true });

  } catch (err) {
    logger.error('[userRouter] DELETE /account error:', {
      uid: req.user?.uid,
      code: err.code,
      message: err.message,
      stack: err.stack,
    });

    // Check if this is a "record not found" error (user already deleted)
    if (err.code === 'P2025') {
      logger.info('[userRouter] Record already deleted — treating as success');
      // Attempt Firebase Auth cleanup
      try {
        await auth.deleteUser(req.user?.uid);
      } catch {
        // Ignore errors
      }
      return res.json({ success: true });
    }

    res.status(500).json({
      error: 'Failed to delete account',
      message: err.message,
      hint: 'Contact support if this persists',
    });
  }
});

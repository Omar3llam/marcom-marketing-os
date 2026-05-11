// ============================================================
// MARCOM / Lumi — User Account Management Routes
// ============================================================
// Protected endpoints for user profile, workspace, and account deletion.
// All routes require Firebase JWT authentication via requireAuth middleware.
// ============================================================
import { Router } from 'express';
import admin from '../utils/firebaseAdmin.js';
import { logger } from '../utils/logger.js';

const auth = admin.auth();
const db = admin.firestore();

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
  try {
    const uid = req.user?.uid;

    if (!uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Find workspace owned by this user
    const workspacesSnapshot = await db.collection('workspaces')
      .where('ownerId', '==', uid)
      .limit(1)
      .get();

    if (workspacesSnapshot.empty) {
      return res.json({
        workspace: null,
        hasWorkspace: false,
      });
    }

    const workspaceDoc = workspacesSnapshot.docs[0];
    const workspaceData = workspaceDoc.data();

    res.json({
      workspace: {
        id: workspaceDoc.id,
        name: workspaceData.name || 'Untitled Workspace',
        slug: workspaceData.slug,
        ownerId: workspaceData.ownerId,
        createdAt: workspaceData.createdAt,
        updatedAt: workspaceData.updatedAt,
      },
      hasWorkspace: true,
    });
  } catch (err) {
    logger.error('[userRouter] GET /workspace error:', err);
    res.status(500).json({ error: 'Failed to fetch workspace' });
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

    // Update Firebase Auth
    await auth.updateUser(uid, { displayName: trimmed });

    // Update Firestore user doc
    const userRef = db.collection('users').doc(uid);
    await userRef.set(
      { displayName: trimmed, updatedAt: new Date() },
      { merge: true }
    );

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

    // Find workspace owned by this user
    const workspacesSnapshot = await db.collection('workspaces')
      .where('ownerId', '==', uid)
      .limit(1)
      .get();

    if (workspacesSnapshot.empty) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const workspaceDoc = workspacesSnapshot.docs[0];
    await workspaceDoc.ref.update({
      name: trimmed,
      updatedAt: new Date(),
    });

    logger.info('[userRouter] Workspace updated:', { uid, workspaceId: workspaceDoc.id, workspaceName: trimmed });

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
 * Steps:
 *   1. Fetch workspaceId from Firestore (not JWT — custom claims not set)
 *   2. Delete Firestore: campaigns, workspaces, users
 *   3. Delete Firebase Auth user (invalidates all tokens)
 *   4. Client must sign out and clear localStorage
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

    // ✅ Step 1: Fetch workspaceId from Firestore user doc
    // Firebase JWTs don't include workspaceId by default — must fetch separately
    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      logger.info('[userRouter] User doc not found — deleting auth user only');
      // User doc already gone, but auth might still exist
      try {
        await auth.deleteUser(uid);
      } catch (authErr) {
        if (authErr.code === 'auth/user-not-found') {
          logger.info('[userRouter] Auth user already deleted');
          return res.json({ success: true });
        }
        throw authErr;
      }
      return res.json({ success: true });
    }

    const userData = userDoc.data();
    const workspaceId = userData?.workspaceId;

    logger.info('[userRouter] Deleting account:', { uid, workspaceId });

    // ✅ Step 2: Delete Firestore data in parallel
    const deleteOps = [];

    // Delete user doc
    deleteOps.push(db.collection('users').doc(uid).delete());

    // Delete workspace if we have the ID
    if (workspaceId) {
      // Delete workspace doc
      deleteOps.push(db.collection('workspaces').doc(workspaceId).delete());

      // Delete campaign subcollections (batch delete for performance)
      deleteOps.push(
        db.collection('campaigns')
          .where('workspaceId', '==', workspaceId)
          .get()
          .then((snapshot) => {
            if (snapshot.empty) return;
            const batch = db.batch();
            snapshot.docs.forEach((doc) => batch.delete(doc.ref));
            return batch.commit();
          })
      );

      // Delete any other workspace-scoped collections
      // (add more collections here as needed)
      deleteOps.push(
        db.collection('actions')
          .where('workspaceId', '==', workspaceId)
          .get()
          .then((snapshot) => {
            if (snapshot.empty) return;
            const batch = db.batch();
            snapshot.docs.forEach((doc) => batch.delete(doc.ref));
            return batch.commit();
          })
      );
    }

    await Promise.all(deleteOps);

    // ✅ Step 3: Delete Firebase Auth user LAST
    // (this invalidates all tokens, so do it after Firestore cleanup)
    await auth.deleteUser(uid);

    logger.warn('[userRouter] Account deleted successfully:', { uid, workspaceId });

    res.json({ success: true });
  } catch (err) {
    logger.error('[userRouter] DELETE /account error:', {
      code: err.code,
      message: err.message,
      stack: err.stack,
    });

    // If user is already deleted from Auth but Firestore cleanup failed,
    // still return success (idempotent)
    if (err.code === 'auth/user-not-found') {
      logger.info('[userRouter] Auth user already deleted — treating as success');
      return res.json({ success: true });
    }

    res.status(500).json({
      error: 'Failed to delete account',
      code: err.code,
      message: err.message,
    });
  }
});

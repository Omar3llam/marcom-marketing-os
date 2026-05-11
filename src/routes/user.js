// ============================================================
// MARCOM / Lumi — User Account Management Routes
// ============================================================
// Protected endpoints for user profile, workspace, and account deletion.
// All routes require Firebase JWT authentication via requireAuth middleware.
// ============================================================
import { Router } from 'express';
import { auth } from '../lib/firebase-admin.js';
import { db } from '../lib/firestore.js';
import { logger } from '../utils/logger.js';

export const userRouter = Router();

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
 *   1. Delete Firestore: workspaces/{workspaceId} + users/{uid}
 *   2. Delete Firebase Auth user
 *   3. Client must sign out and clear localStorage
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

    // 1. Find and delete workspace(s) owned by this user
    const workspacesSnapshot = await db.collection('workspaces')
      .where('ownerId', '==', uid)
      .get();

    const batch = db.batch();

    for (const doc of workspacesSnapshot.docs) {
      logger.info('[userRouter] Deleting workspace:', { workspaceId: doc.id });
      batch.delete(doc.ref);
    }

    // 2. Delete user doc
    const userRef = db.collection('users').doc(uid);
    batch.delete(userRef);

    await batch.commit();

    // 3. Delete Firebase Auth user (this invalidates all tokens)
    await auth.deleteUser(uid);

    logger.warn('[userRouter] Account deleted:', { uid });

    res.json({ success: true });
  } catch (err) {
    logger.error('[userRouter] DELETE /account error:', err);

    // If user is already deleted from Auth but Firestore cleanup failed,
    // still return success (idempotent)
    if (err.code === 'auth/user-not-found') {
      return res.json({ success: true });
    }

    res.status(500).json({ error: 'Failed to delete account' });
  }
});

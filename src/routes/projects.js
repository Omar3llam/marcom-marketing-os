// ============================================================
// MARCOM — Projects API
//
//   POST   /api/projects/create         create a new project
//   GET    /api/projects/list           list user's projects (+ auto-migrate)
//   GET    /api/projects/:projectId     load a single project (with context)
//   PATCH  /api/projects/:projectId     update name/context
//   DELETE /api/projects/:projectId     delete (guard: cannot delete last)
//
// Auth: req.userId set by requireAuth middleware (clerkAuth.js).
// ============================================================
import { Router } from 'express';
import { logger } from '../utils/logger.js';
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
  countUserProjects,
  disassociateProjectSessions,
  migrateFromUserContext,
} from '../models/project.js';

export const projectsRouter = Router();

const MAX_CONTEXT_LEN = 16_000;
const MAX_NAME_LEN    = 80;

// ── POST /api/projects/create ────────────────────────────────
projectsRouter.post('/create', async (req, res) => {
  const userId = req.userId;
  const { projectId, name, context } = req.body || {};

  if (!projectId || typeof projectId !== 'string' || !projectId.trim()) {
    return res.status(400).json({ error: 'projectId is required' });
  }
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!context || typeof context !== 'string' || !context.trim()) {
    return res.status(400).json({ error: 'context is required' });
  }
  if (context.length > MAX_CONTEXT_LEN) {
    return res.status(400).json({ error: 'context too large (max 16 000 chars)' });
  }
  if (name.length > MAX_NAME_LEN) {
    return res.status(400).json({ error: 'name too long (max 80 chars)' });
  }

  try {
    await createProject(userId, { projectId, name, context });
    return res.status(201).json({ ok: true, projectId });
  } catch (err) {
    if (err.code === '23505') {
      // PostgreSQL unique-constraint violation — projectId already exists
      return res.status(409).json({ error: 'Project ID already exists. Please try again.' });
    }
    logger.error({ err, userId }, 'projects.create failed');
    return res.status(500).json({ error: 'Create failed' });
  }
});

// ── GET /api/projects/list ───────────────────────────────────
// Returns [ { projectId, name, updatedAt } ] — no context strings (keep payload small).
// Auto-migrates from legacy UserContext on first call when user has zero projects.
projectsRouter.get('/list', async (req, res) => {
  const userId = req.userId;
  try {
    let projects = await listProjects(userId);

    if (projects.length === 0) {
      // Silent one-time migration — user already onboarded via old wizard
      await migrateFromUserContext(userId);
      projects = await listProjects(userId);
    }

    return res.json(projects);
  } catch (err) {
    logger.error({ err, userId }, 'projects.list failed');
    return res.status(500).json({ error: 'List failed' });
  }
});

// ── GET /api/projects/:projectId ─────────────────────────────
// Returns full project including context. 404 if not found or wrong user.
projectsRouter.get('/:projectId', async (req, res) => {
  const userId            = req.userId;
  const { projectId }     = req.params;

  try {
    const project = await getProject(userId, projectId);
    if (!project) return res.status(404).json({ error: 'Not found' });
    return res.json(project);
  } catch (err) {
    logger.error({ err, userId, projectId }, 'projects.get failed');
    return res.status(500).json({ error: 'Lookup failed' });
  }
});

// ── PATCH /api/projects/:projectId ───────────────────────────
// Partial update — provide name and/or context.
projectsRouter.patch('/:projectId', async (req, res) => {
  const userId        = req.userId;
  const { projectId } = req.params;
  const fields        = req.body || {};

  if (fields.name === undefined && fields.context === undefined) {
    return res.status(400).json({ error: 'Provide name and/or context to update' });
  }
  if (fields.context !== undefined && fields.context.length > MAX_CONTEXT_LEN) {
    return res.status(400).json({ error: 'context too large (max 16 000 chars)' });
  }
  if (fields.name !== undefined && fields.name.length > MAX_NAME_LEN) {
    return res.status(400).json({ error: 'name too long (max 80 chars)' });
  }

  try {
    const updated = await updateProject(userId, projectId, {
      ...(fields.name    !== undefined && { name:    fields.name }),
      ...(fields.context !== undefined && { context: fields.context }),
    });
    if (!updated) return res.status(404).json({ error: 'Not found or unauthorized' });
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err, userId, projectId }, 'projects.update failed');
    return res.status(500).json({ error: 'Update failed' });
  }
});

// ── DELETE /api/projects/:projectId ──────────────────────────
// Protects: cannot delete the user's only project.
// On success: nullifies project_id on orphaned sessions.
projectsRouter.delete('/:projectId', async (req, res) => {
  const userId        = req.userId;
  const { projectId } = req.params;

  try {
    const count = await countUserProjects(userId);
    if (count <= 1) {
      return res.status(400).json({
        error: 'Cannot delete your only project. Create another first.',
      });
    }

    const deleted = await deleteProject(userId, projectId);
    if (!deleted) return res.status(404).json({ error: 'Not found or unauthorized' });

    // Orphan sessions remain accessible — they just have no project link
    await disassociateProjectSessions(projectId);

    logger.info({ userId, projectId }, 'Project deleted');
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err, userId, projectId }, 'projects.delete failed');
    return res.status(500).json({ error: 'Delete failed' });
  }
});

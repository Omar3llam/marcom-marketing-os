// ============================================================
// MARCOM — Project model (PostgreSQL)
// One row per project, scoped to a Clerk userId.
// Replaces the single-global UserContext for multi-project support.
// All queries are parameterised — no string interpolation.
// ============================================================
import { getDb }    from '../utils/db.js';
import { logger }   from '../utils/logger.js';
import { getUserContext } from './userContext.js';

const MAX_CONTEXT_LEN = 16_000;
const MAX_NAME_LEN    = 80;

// ── Idempotent migration — run once at startup ───────────────
export async function ensureProjectSchema() {
  const sql = getDb();
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS marcom_projects (
        project_id   TEXT        PRIMARY KEY,
        user_id      TEXT        NOT NULL,
        name         TEXT        NOT NULL DEFAULT '',
        context      TEXT        NOT NULL DEFAULT '',
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_projects_user_id
        ON marcom_projects (user_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_projects_user_updated
        ON marcom_projects (user_id, updated_at DESC)
    `;
    // Add project_id to sessions (idempotent)
    await sql`
      ALTER TABLE marcom_sessions
        ADD COLUMN IF NOT EXISTS project_id TEXT DEFAULT NULL
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_sessions_project_id
        ON marcom_sessions (project_id)
    `;
    logger.info('[project] schema ensured');
  } catch (err) {
    logger.warn({ err: err.message }, '[project] ensureSchema failed (non-fatal)');
  }
}

// ── CRUD ─────────────────────────────────────────────────────

export async function createProject(userId, { projectId, name, context }) {
  const sql = getDb();
  const rows = await sql`
    INSERT INTO marcom_projects (project_id, user_id, name, context)
    VALUES (
      ${projectId},
      ${userId},
      ${String(name).slice(0, MAX_NAME_LEN)},
      ${String(context).slice(0, MAX_CONTEXT_LEN)}
    )
    RETURNING project_id, name, created_at, updated_at
  `;
  return rows[0];
}

export async function listProjects(userId) {
  const sql = getDb();
  const rows = await sql`
    SELECT project_id, name, updated_at
    FROM marcom_projects
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
  `;
  return rows.map(r => ({
    projectId: r.project_id,
    name:      r.name,
    updatedAt: r.updated_at,
  }));
}

/**
 * Load a single project — scoped to userId (ownership check included).
 */
export async function getProject(userId, projectId) {
  const sql = getDb();
  const rows = await sql`
    SELECT project_id, name, context, created_at, updated_at
    FROM marcom_projects
    WHERE project_id = ${projectId}
      AND user_id    = ${userId}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    projectId: r.project_id,
    name:      r.name,
    context:   r.context,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Internal lookup — no userId check.
 * Used by master.js for context injection when the session already
 * belongs to the authenticated user (ownership verified at session level).
 */
export async function getProjectById(projectId) {
  if (!projectId) return null;
  const sql = getDb();
  const rows = await sql`
    SELECT project_id, name, context
    FROM marcom_projects
    WHERE project_id = ${projectId}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return {
    projectId: rows[0].project_id,
    name:      rows[0].name,
    context:   rows[0].context,
  };
}

export async function updateProject(userId, projectId, fields) {
  const sql = getDb();
  const hasName    = fields.name    !== undefined;
  const hasContext = fields.context !== undefined;
  if (!hasName && !hasContext) return null;

  const name    = hasName    ? String(fields.name).slice(0, MAX_NAME_LEN)       : undefined;
  const context = hasContext ? String(fields.context).slice(0, MAX_CONTEXT_LEN) : undefined;

  let rows;
  if (hasName && hasContext) {
    rows = await sql`
      UPDATE marcom_projects
         SET name = ${name}, context = ${context}, updated_at = NOW()
       WHERE project_id = ${projectId} AND user_id = ${userId}
      RETURNING project_id
    `;
  } else if (hasName) {
    rows = await sql`
      UPDATE marcom_projects
         SET name = ${name}, updated_at = NOW()
       WHERE project_id = ${projectId} AND user_id = ${userId}
      RETURNING project_id
    `;
  } else {
    rows = await sql`
      UPDATE marcom_projects
         SET context = ${context}, updated_at = NOW()
       WHERE project_id = ${projectId} AND user_id = ${userId}
      RETURNING project_id
    `;
  }
  return rows.length > 0 ? rows[0] : null;
}

export async function deleteProject(userId, projectId) {
  const sql = getDb();
  const rows = await sql`
    DELETE FROM marcom_projects
    WHERE project_id = ${projectId}
      AND user_id    = ${userId}
    RETURNING project_id
  `;
  return rows.length > 0;
}

export async function countUserProjects(userId) {
  const sql = getDb();
  const rows = await sql`
    SELECT COUNT(*) AS n FROM marcom_projects WHERE user_id = ${userId}
  `;
  return parseInt(rows[0].n, 10);
}

/**
 * Nullify project_id on sessions linked to a deleted project.
 * Called after deleteProject() so orphaned sessions remain accessible.
 */
export async function disassociateProjectSessions(projectId) {
  const sql = getDb();
  await sql`
    UPDATE marcom_sessions SET project_id = NULL
    WHERE project_id = ${projectId}
  `;
}

/**
 * One-time migration: if user has no projects but has a legacy UserContext
 * row, create "My First Project" from it. Returns the new projectId or null.
 */
export async function migrateFromUserContext(userId) {
  try {
    const context = await getUserContext(userId);
    if (!context) return null;
    const projectId = `proj_${userId.slice(-8)}_${Date.now()}`;
    await createProject(userId, { projectId, name: 'My First Project', context });
    logger.info({ userId, projectId }, 'Auto-migrated legacy context → project');
    return projectId;
  } catch (err) {
    logger.warn({ err: err.message, userId }, 'migrateFromUserContext failed (non-fatal)');
    return null;
  }
}

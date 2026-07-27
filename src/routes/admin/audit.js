// ============================================================
// MARCOM / Admin — Action log
//   GET /api/admin/audit?limit=50&before=<iso> — admin-panel mutations, newest first.
//
// ADMIN-only (gated at the mount). Cross-workspace by definition — the log
// records the one surface where workspace isolation is intentionally lifted.
//
// Cursor pagination on createdAt rather than offset: rows only ever arrive at
// the head, so an offset would re-serve or skip rows as the log grows. Errors
// return { error: message } only — never a trace.
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';

export const auditRouter = Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = Number(process.env.ADMIN_MAX_AUDIT || 200);

// parseInt('abc') is NaN and Math.min(NaN, n) is NaN, which Prisma rejects —
// so a junk ?limit must fall back to the default, not reach `take`.
function parseLimit(raw) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

// An unparseable ?before must not silently become "the beginning of time" —
// `new Date('junk')` is Invalid Date, which Prisma would throw on. Ignore it
// and serve the head of the log instead.
function parseCursor(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

auditRouter.get('/', async (req, res) => {
  const limit = parseLimit(req.query.limit);
  const before = parseCursor(req.query.before);

  try {
    const logs = await prisma.adminAuditLog.findMany({
      where: before ? { createdAt: { lt: before } } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        actorEmail: true,
        type: true,
        targetType: true,
        targetId: true,
        workspaceId: true,
        before: true,
        after: true,
        createdAt: true,
      },
    });

    // A full page means there MAY be more; a short page means there is not.
    const nextCursor = logs.length === limit && logs.length > 0
      ? new Date(logs[logs.length - 1].createdAt).toISOString()
      : null;

    return res.json({ logs, nextCursor });
  } catch (err) {
    logger.error({ err: err.message }, '[admin/audit] list failed');
    return res.status(500).json({ error: 'Failed to list admin actions' });
  }
});

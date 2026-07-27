// ============================================================
// MARCOM / Admin — Router assembly
// Assembles all admin sub-routers into one adminRouter.
// Mount point (server.js):
//   app.use('/api/admin', requireAuth, requireAdmin, adminRouter)
// Every sub-route is therefore ADMIN-only; no route re-checks the role.
// ============================================================
import { Router } from 'express';
import { statusRouter }     from './status.js';
import { workspacesRouter } from './workspaces.js';
import { usersRouter }      from './users.js';
import { demoRouter }       from './demo.js';
import { auditRouter }      from './audit.js';

export const adminRouter = Router();

adminRouter.use('/status',     statusRouter);
adminRouter.use('/workspaces', workspacesRouter);
adminRouter.use('/users',      usersRouter);
adminRouter.use('/demo',       demoRouter);
adminRouter.use('/audit',      auditRouter);

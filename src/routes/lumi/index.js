// ============================================================
// MARCOM / Lumi — Router assembly
// Assembles all lumi sub-routers into one lumiRouter.
// Mount point: app.use('/api/lumi', requireJwt, lumiRouter)
// ============================================================
import { Router }              from 'express';
import { rollbackRouter }      from './rollback.js';
import { quickActionRouter, quickActionHandler } from './quickaction.js';
import { feedRouter, demoFeedHandler } from './feed.js';
import { intelligenceRouter }  from './intelligence.js';
import { healthRouter }        from './health.js';

export const lumiRouter = Router();

// Re-export handlers for server.js (public/special auth routes)
export { demoFeedHandler, quickActionHandler };

// Mount sub-routers
lumiRouter.use('/rollback', rollbackRouter);
lumiRouter.use('/', feedRouter);
lumiRouter.use('/', intelligenceRouter);
lumiRouter.use('/', healthRouter);

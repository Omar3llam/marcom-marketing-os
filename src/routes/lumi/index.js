// ============================================================
// MARCOM / Lumi — Router assembly
// Assembles all lumi sub-routers into one lumiRouter.
// Mount point: app.use('/api/lumi', requireJwt, lumiRouter)
// ============================================================
import { Router }              from 'express';
import { rollbackRouter }            from './rollback.js';
import { quickActionHandler }        from './quickaction.js';
import { feedRouter, demoFeedHandler } from './feed.js';
import { intelligenceRouter }        from './intelligence.js';
import { healthRouter }              from './health.js';
import { portfolioRouter }           from './portfolio.js';
import { testingRouter }             from './testing.js';
import { memoryRouter }              from './memory.js';
import { planningRouter }            from './planning.js';
import { measurementRouter }         from './measurement.js';
import { collaborationRouter }       from './collaboration.js';
import { agenticRouter }             from './agentic.js';
import { accuracyRouter }            from './accuracy.js';
import { connectionsRouter }         from './connections.js';
import { entitiesRouter }            from './entities.js';
import { revenueRouter }             from './revenue.js';
import { copilotRouter }             from './copilot.js';
import { decisionsRouter }           from './decisions.js';
import { accountRouter }             from './account.js';
import { executionsRouter }          from './executions.js';

export const lumiRouter = Router();

// Re-export handlers for server.js (public/special auth routes)
export { demoFeedHandler, quickActionHandler };

// Mount sub-routers
lumiRouter.use('/rollback', rollbackRouter);
lumiRouter.use('/', feedRouter);
lumiRouter.use('/', intelligenceRouter);
lumiRouter.use('/', healthRouter);
lumiRouter.use('/', portfolioRouter);
lumiRouter.use('/', testingRouter);
lumiRouter.use('/', memoryRouter);
lumiRouter.use('/', planningRouter);
lumiRouter.use('/', measurementRouter);
lumiRouter.use('/', collaborationRouter);
lumiRouter.use('/', agenticRouter);
lumiRouter.use('/', accuracyRouter);
lumiRouter.use('/', connectionsRouter);
lumiRouter.use('/', entitiesRouter);
lumiRouter.use('/', revenueRouter);
lumiRouter.use('/', copilotRouter);
lumiRouter.use('/', decisionsRouter);
lumiRouter.use('/', accountRouter);
lumiRouter.use('/', executionsRouter);

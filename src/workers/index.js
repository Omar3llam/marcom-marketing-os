// ============================================================
// MARCOM / Lumi — Worker Process Bootstrap
// ------------------------------------------------------------
// Run with:  npm run worker
//
// Boots both the Action worker (Phase 2) and the Temporal
// Observer worker + cron schedule (Phase 3) in a single Node
// process. For multi-instance deploys, run multiple copies
// behind the same Redis — BullMQ handles partitioning.
// ============================================================
import 'dotenv/config';
import { startActionWorker }       from './actionWorker.js';
import { startObserverWorker }     from '../services/temporalObserver.js';
import { startSyncWorker }         from './syncWorker.js';
import { scheduleCampaignSync }    from '../queues/index.js';
import { logger }                  from '../utils/logger.js';

const actionWorker   = startActionWorker();
const observerWorker = startObserverWorker();
const syncWorker     = startSyncWorker();

// Schedule automatic campaign sync cron job (daily by default)
scheduleCampaignSync()
  .then(() => logger.info('[worker] campaign sync scheduled'))
  .catch(err => logger.warn({ err: err.message }, '[worker] campaign sync schedule failed'));

async function shutdown(signal) {
  logger.info({ signal }, '[worker] shutting down');
  await Promise.allSettled([
    actionWorker.close(),
    observerWorker.close(),
    syncWorker.close(),
  ]);
  process.exit(0);
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

logger.info('[worker] all workers online');

// ============================================================
// MARCOM / Lumi — Worker Process Bootstrap
// ------------------------------------------------------------
// Run with:  npm run worker
//
// Boots the action, execution, sync, agentic, narrative and
// maintenance workers in a single Node process.
// For multi-instance deploys, run multiple copies
// behind the same Redis — BullMQ handles partitioning.
// ============================================================
import 'dotenv/config';
import { startActionWorker }    from './actionWorker.js';
import { startExecutionWorker } from './executionWorker.js';
// R7 — the Temporal Observer worker is gone. Its sweep read DecisionMemory with
// columns that table does not have, in the same Promise.all as its CampaignState
// read, so every tick with candidate Actions threw and every tick without them
// was a no-op. It could not write a memory row or a stage transition, and had
// not been able to since the two shapes diverged. Retired rather than repaired:
// rebuilding stage transitions on canonical data is its own project.
import { startSyncWorker }      from './syncWorker.js';
import { startAgenticWorker }   from './agenticWorker.js';
import { startNarrativeWorker } from './narrativeWorker.js';
import { startMaintenanceWorker } from './maintenanceWorker.js';
import { scheduleCampaignSync } from '../queues/index.js';
import { logger }               from '../utils/logger.js';

const actionWorker    = startActionWorker();
const executionWorker = startExecutionWorker();
const syncWorker      = startSyncWorker();
const agenticWorker   = startAgenticWorker();   // Phase 9 — proactive loop sweep
const narrativeWorker = startNarrativeWorker(); // Phase 8 — weekly/monthly report cadence
// Retention housekeeping. Always on — it deletes, it does not spend, and it
// registers its own daily repeat.
const maintenanceWorker = startMaintenanceWorker();

// Schedule automatic campaign sync cron job (daily by default)
scheduleCampaignSync()
  .then(() => logger.info('[worker] campaign sync scheduled'))
  .catch(err => logger.warn({ err: err.message }, '[worker] campaign sync schedule failed'));

async function shutdown(signal) {
  logger.info({ signal }, '[worker] shutting down');
  await Promise.allSettled([
    actionWorker.close(),
    executionWorker.close(),
    syncWorker.close(),
    agenticWorker.close(),
    narrativeWorker.close(),
    maintenanceWorker.close(),
  ]);
  process.exit(0);
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

logger.info('[worker] all workers online');

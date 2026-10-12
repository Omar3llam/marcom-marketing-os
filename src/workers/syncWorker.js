// ============================================================
// MARCOM / Lumi — Connector Sync Worker (Phase 12)
// ------------------------------------------------------------
// The third cron loop (Agentic · Observer · Connector Sync). Each run:
//   1. runConnectorSync — for every ACTIVE syncable Integration, land fresh
//      MetricSnapshots via its connector (per-channel failure isolation +
//      health recording). This is the first real ingestion sink.
//   2. sweepGuardrails — after fresh metrics land, enforce guardrail rules →
//      PROPOSED Decisions the human confirms (never auto-executed).
//   3. runSweep — re-score the freshly-landed data NOW (deterministic connector
//      verdicts + fatigue + the portfolio advisory) instead of leaving it for the
//      next agentic tick. Without this, ingestion and analysis were separate crons
//      and a sync's data sat unanalysed until the loop happened to fire.
//
// NOTE: the prior worker read `prisma.credential` (a model that does NOT exist
// in the schema) and analyzed via Claude into Action rows — that path threw at
// runtime and never ran. It is replaced here by the connector contract; the
// canonical decision path is the guardrail sweep (Phase 2+).
// ============================================================
import { Worker } from 'bullmq';
import { bullConnection, QUEUE_PREFIX } from '../queues/connection.js';
import { SYNC_QUEUE_NAME } from '../queues/index.js';
import { logger } from '../utils/logger.js';
import { runConnectorSync } from '../services/connectors/ConnectorSyncService.js';
import { sweepGuardrails } from '../services/guardrail-engine/GuardrailSweepService.js';
import { runSweep } from '../services/agentic-loop/AgenticLoopService.js';
import { DEFAULT_CRON_SYNC_DATE_PRESET } from '../services/connectors/connectorConfig.js';
import { prisma } from '../lib/prisma.js';
import { assertWorkspaceLive, isWorkspaceScopeError } from '../lib/workspaceLiveness.js';

// ── Worker Job Handler ────────────────────────────────────────
async function processSyncJob(job) {
  // Cron tick: bounded window (catch NEW delivery), never an unattended
  // re-pull of years of history. A caller may still override via job.data.
  const { workspaceId = null, datePreset = DEFAULT_CRON_SYNC_DATE_PRESET } = job.data || {};
  logger.info({ jobId: job.id, workspaceId }, '[syncWorker] starting connector sync');

  // 1. Ingest fresh snapshots across connected channels (isolated per channel).
  const ingest = await runConnectorSync(workspaceId, { datePreset });

  // 2. Guardrail sweep per affected workspace — best-effort, never fails the job.
  const workspaceIds = workspaceId
    ? [workspaceId]
    : [...new Set(ingest.results.map((r) => r.workspaceId))];
  let guardrailHits = 0;
  let swept = 0;
  // The post-sync sweep re-scores freshly-landed data, but it fans out to the AI
  // gateway (per-campaign reasoning + ANALYZE_PORTFOLIO per workspace) — so it
  // costs AI spend on every sync. Gate it behind SYNC_TRIGGERS_SWEEP: ON unless
  // explicitly "false" (backward-compatible default). When off, manual + on-read
  // sweeps still re-score; the sync just doesn't auto-trigger one.
  const syncTriggersSweep = process.env.SYNC_TRIGGERS_SWEEP !== 'false';
  if (!syncTriggersSweep) {
    logger.info({ jobId: job.id }, '[syncWorker] post-sync sweep disabled (SYNC_TRIGGERS_SWEEP=false)');
  }
  for (const wsId of workspaceIds) {
    // Failed/skipped live connections still sweep; scope liveness is independent.
    try {
      await assertWorkspaceLive(prisma, wsId);
    } catch (err) {
      if (!isWorkspaceScopeError(err)) throw err;
      logger.warn({ code: err.code }, '[syncWorker] workspace scope refused before sweeps');
      continue;
    }
    try {
      const g = await sweepGuardrails(wsId);
      guardrailHits += g.hits ?? 0;
    } catch (err) {
      logger.warn({ wsId, err: err.message }, '[syncWorker] guardrail sweep failed — continuing');
    }

    // 3. Analyse the data we just landed. force:true because this job IS the
    //    reason to re-score — the sweep's 15-minute idempotency window would
    //    otherwise reuse a pre-sync agenda and the fresh data would go unread.
    //    Gated by SYNC_TRIGGERS_SWEEP (see above). Per-workspace isolation: a
    //    sweep failure never blocks the next workspace and never fails the ingest
    //    that already succeeded.
    if (syncTriggersSweep) {
      try {
        await runSweep(wsId, { trigger: 'SCHEDULED', force: true });
        swept += 1;
      } catch (err) {
        logger.warn({ wsId, err: err.message }, '[syncWorker] post-sync sweep failed — continuing');
      }
    }
  }

  logger.info({ jobId: job.id, synced: ingest.synced, failed: ingest.failed, guardrailHits, swept }, '[syncWorker] complete');
  return { status: 'complete', ...ingest, guardrailHits, swept };
}

// ── Worker Bootstrap ──────────────────────────────────────────
export function startSyncWorker() {
  if (!bullConnection) {
    logger.warn('[syncWorker] Redis disabled — worker not started');
    return { close: async () => {} };
  }

  const worker = new Worker(SYNC_QUEUE_NAME, processSyncJob, {
    connection: bullConnection,
    prefix: QUEUE_PREFIX,
    concurrency: 1, // serialize to avoid platform rate limits
  });

  worker.on('completed', (j) => logger.info({ jobId: j.id, result: j.returnvalue }, '[syncWorker] job completed'));
  worker.on('failed', (j, err) => logger.error({ jobId: j?.id, err: err.message }, '[syncWorker] job failed'));

  logger.info('[syncWorker] online (connector-driven)');
  return worker;
}

// Re-exported for direct invocation / tests.
export { runConnectorSync };

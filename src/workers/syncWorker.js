// ============================================================
// MARCOM / Lumi — Connector Sync Worker (Phase 12)
// ------------------------------------------------------------
// The third cron loop (Agentic · Observer · Connector Sync). Each run:
//   1. runConnectorSync — for every ACTIVE syncable Integration, land fresh
//      MetricSnapshots via its connector (per-channel failure isolation +
//      health recording). This is the first real ingestion sink.
//   2. sweepGuardrails — after fresh metrics land, enforce guardrail rules →
//      PROPOSED Decisions the human confirms (never auto-executed).
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

// ── Worker Job Handler ────────────────────────────────────────
async function processSyncJob(job) {
  const { workspaceId = null, datePreset = 'last_7d' } = job.data || {};
  logger.info({ jobId: job.id, workspaceId }, '[syncWorker] starting connector sync');

  // 1. Ingest fresh snapshots across connected channels (isolated per channel).
  const ingest = await runConnectorSync(workspaceId, { datePreset });

  // 2. Guardrail sweep per affected workspace — best-effort, never fails the job.
  const workspaceIds = workspaceId
    ? [workspaceId]
    : [...new Set(ingest.results.map((r) => r.workspaceId))];
  let guardrailHits = 0;
  for (const wsId of workspaceIds) {
    try {
      const g = await sweepGuardrails(wsId);
      guardrailHits += g.hits ?? 0;
    } catch (err) {
      logger.warn({ wsId, err: err.message }, '[syncWorker] guardrail sweep failed — continuing');
    }
  }

  logger.info({ jobId: job.id, synced: ingest.synced, failed: ingest.failed, guardrailHits }, '[syncWorker] complete');
  return { status: 'complete', ...ingest, guardrailHits };
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

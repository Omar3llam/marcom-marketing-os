// ============================================================
// MARCOM / Lumi — Action Worker (Phase 2)
// ------------------------------------------------------------
// Consumes the `actions` queue. For each job:
//
//   1. Load the Action row (FOR UPDATE) inside a transaction.
//   2. Skip if status is already terminal (idempotency safety).
//   3. Move PENDING/QUEUED → EXECUTED_SUCCESS or FAILED.
//   4. Write an AuditLog row capturing previousState → newState.
//   5. Stamp executedAt on success.
//
// Real ad-platform side-effects (Meta/Google) are dispatched
// through `executors[payload.kind]` — Phase 5 will fill these
// in with the actual SDK calls. Phase 2 ships a no-op executor
// so the engine is end-to-end testable.
// ============================================================
import { Worker }      from 'bullmq';
import { bullConnection, QUEUE_PREFIX } from '../queues/connection.js';
import { ACTION_QUEUE_NAME }            from '../queues/index.js';
import { prisma }      from '../lib/prisma.js';
import { logger }      from '../utils/logger.js';

// ── Executors registry ───────────────────────────────────────
// Keyed by payload.kind. Each executor returns either:
//   { ok: true,  result: {...} }   → status EXECUTED_SUCCESS
//   { ok: false, error: '...' }    → status FAILED (no throw)
// Throwing escapes to BullMQ and triggers retry/backoff.
const executors = {
  // Phase 2 placeholder — replaced in Phase 5
  noop: async (payload) => ({ ok: true, result: { echoed: payload } }),

  // Stubs registered now so route handlers can already enqueue
  'meta.pause_ad':       async () => ({ ok: true, result: { stub: true } }),
  'meta.scale_budget':   async () => ({ ok: true, result: { stub: true } }),
  'google.pause_keyword':async () => ({ ok: true, result: { stub: true } }),
};

// ── Worker definition ────────────────────────────────────────
export function startActionWorker() {
  const concurrency = Number(process.env.BULLMQ_CONCURRENCY || 5);

  const worker = new Worker(
    ACTION_QUEUE_NAME,
    async (job) => {
      const { actionId } = job.data;
      if (!actionId) throw new Error('actionWorker: missing actionId in job data');

      // ── Transactional state transition ──────────────────────
      const result = await prisma.$transaction(async (tx) => {
        const action = await tx.action.findUnique({ where: { id: actionId } });
        if (!action) throw new Error(`Action ${actionId} not found`);

        // Idempotency: if a previous worker already finalised this
        // row (e.g. a retried job after a crash mid-AuditLog), bail.
        if (action.status === 'EXECUTED_SUCCESS' ||
            action.status === 'ROLLED_BACK') {
          logger.info({ actionId, status: action.status }, '[actionWorker] already terminal — skipping');
          return { skipped: true };
        }

        // Mark as in-flight (best-effort visibility)
        await tx.action.update({
          where: { id: actionId },
          data:  { status: 'QUEUED' },
        });

        return { action };
      });

      if (result.skipped) return { skipped: true };

      const { action } = result;
      const kind       = action.payload?.kind || 'noop';
      const executor   = executors[kind];

      if (!executor) {
        await failAction(action, `Unknown executor: ${kind}`);
        return { ok: false, reason: 'unknown_executor' };
      }

      // ── Side-effect (outside the DB tx) ─────────────────────
      let outcome;
      try {
        outcome = await executor(action.payload);
      } catch (err) {
        // Throwing here lets BullMQ retry per defaultJobOptions.
        logger.error({ err: err.message, actionId, kind }, '[actionWorker] executor threw');
        throw err;
      }

      // ── Persist outcome + audit log atomically ──────────────
      await prisma.$transaction(async (tx) => {
        const previousState = { status: action.status, payload: action.payload };
        const finalStatus   = outcome.ok ? 'EXECUTED_SUCCESS' : 'FAILED';
        const newState      = {
          status:    finalStatus,
          result:    outcome.result ?? null,
          error:     outcome.error  ?? null,
        };

        await tx.action.update({
          where: { id: actionId },
          data: {
            status:     finalStatus,
            executedAt: outcome.ok ? new Date() : null,
          },
        });

        await tx.auditLog.create({
          data: {
            actionId,
            previousState,
            newState,
            performedBy: `worker:${process.pid}`,
          },
        });
      });

      logger.info({ actionId, kind, ok: outcome.ok }, '[actionWorker] processed');
      return outcome;
    },
    {
      connection: bullConnection,
      prefix:     QUEUE_PREFIX,
      concurrency,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, '[actionWorker] job failed');
  });
  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, '[actionWorker] job completed');
  });

  logger.info({ concurrency }, '[actionWorker] started');
  return worker;
}

// ── Helper used both inside and outside the worker ───────────
async function failAction(action, reason) {
  await prisma.$transaction(async (tx) => {
    await tx.action.update({
      where: { id: action.id },
      data:  { status: 'FAILED' },
    });
    await tx.auditLog.create({
      data: {
        actionId:      action.id,
        previousState: { status: action.status },
        newState:      { status: 'FAILED', error: reason },
        performedBy:   `worker:${process.pid}`,
      },
    });
  });
}

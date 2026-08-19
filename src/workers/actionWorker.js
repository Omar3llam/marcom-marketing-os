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
//
// ── R13-D / B3-B (§9) — NO EXECUTOR HERE MAY REPORT SUCCESS ──────────────────
//
// Every entry in this registry used to return `{ ok: true }` without touching
// an ad platform:
//
//   noop                  → { ok: true, result: { echoed: payload } }
//   meta.pause_ad         → { ok: true, result: { stub: true } }
//   meta.scale_budget     → { ok: true, result: { stub: true } }
//   google.pause_keyword  → { ok: true, result: { stub: true } }
//
// `{ ok: true }` here writes EXECUTED_SUCCESS and stamps `executedAt` on the
// Action row. So a rollback — the one operation whose entire purpose is undoing
// a real change on a real ad account — reported that it had succeeded while the
// campaign carried on exactly as before. The route producing those payloads is
// live (routes/lumi/rollback.js, routes/lumi/quickaction.js), so this was not
// dormant scaffolding; it was a reachable path that lied.
//
// This substrate could not simply be deleted: those two routes depend on it and
// removal would break them, so the safe treatment is the loud one. Each kind now
// FAILS with a message naming itself. The comparison that matters is against the
// canonical path: POST /api/execute/meta → executionWorker → executeMetaAction()
// makes a real Graph API call and records what Meta actually returned. This
// substrate never did, and now says so instead of pretending.
//
// Adding a real executor here is not the fix. Route the action through the
// canonical producer; a second execution path is what produced this divergence.
//
const notImplemented = (kind) => async () => ({
  ok: false,
  error:
    `No executor is implemented for "${kind}". This legacy Action path performs no ` +
    `real platform mutation — it previously reported success without one. Real Meta ` +
    `mutations go through POST /api/execute/meta → executionWorker → executeMetaAction().`,
});

// Exported so the "no executor may report success" property is testable
// directly. It is the kind of invariant that is easy to reintroduce by adding
// one convenient-looking entry, and a test that enumerates the registry catches
// that where a test of any single kind would not.
export const executors = {
  // Registered so the failure names the kind rather than falling through to the
  // generic "unknown executor" branch — "not implemented" and "never heard of
  // it" are different problems and an operator should be able to tell them apart.
  noop:                   notImplemented('noop'),
  'meta.pause_ad':        notImplemented('meta.pause_ad'),
  'meta.scale_budget':    notImplemented('meta.scale_budget'),
  'google.pause_keyword': notImplemented('google.pause_keyword'),
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
      // R13-D / B3-B (§9) — an absent kind is a failure, not a no-op.
      //
      // This read `action.payload?.kind || 'noop'`, and `noop` returned
      // `{ ok: true }`. Any Action row whose payload omitted `kind` therefore
      // reached EXECUTED_SUCCESS with `executedAt` stamped and nothing changed
      // on any ad platform — the default case was the fake-success case, which
      // is the worst place for one to hide.
      const kind     = action.payload?.kind || null;
      const executor = kind ? executors[kind] : null;

      if (!kind) {
        await failAction(action, 'Action payload names no executor kind');
        return { ok: false, reason: 'no_executor_kind' };
      }

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

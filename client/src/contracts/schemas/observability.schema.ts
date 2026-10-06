import { z } from 'zod';

const count = z.number().int().nonnegative();
const duration = z.number().finite().nonnegative().nullable();
const timestamp = z.string().datetime({ offset: true });

export const ObservabilityLiveSchema = z.object({
  executions: z.object({ active: count, paused: count, queued: count, failed_last_hour: count }),
  queue: z.object({ depth: count, avg_wait_ms: duration, oldest_queued_at: timestamp.nullable() }),
  recent_activity: z.array(z.object({
    execution_id: z.string().min(1), status: z.string().min(1), active_step: z.string().nullable(),
    created_at: timestamp, elapsed_ms: z.number().finite().nonnegative(), correlation_id: z.string().nullable(),
  })),
  generated_at: timestamp,
}).superRefine(({ queue }, ctx) => {
  if (queue.depth === 0 ? queue.avg_wait_ms !== null || queue.oldest_queued_at !== null
    : queue.avg_wait_ms === null || queue.oldest_queued_at === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['queue'], message: 'Queue depth and wait applicability disagree' });
  }
});

// Existing displayed facts from two independent windows, never health verdicts.
export const RuntimeVitalsSchema = z.object({
  inFlightCount: count, successPerHour: count, failedPerHour: count, p95LatencyMs: duration,
  windowMinutes: z.number().int().positive(), serverNow: timestamp,
});
export const ExecutionMetricsSummarySchema = z.object({
  total_executions: count, success_rate: z.number().finite().min(0).max(1).nullable(),
  avg_execution_ms: duration, windowDays: z.number().int().positive(),
}).superRefine((m, ctx) => {
  if (m.total_executions === 0 ? m.success_rate !== null || m.avg_execution_ms !== null : m.success_rate === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Historical population and measurements disagree' });
  }
});

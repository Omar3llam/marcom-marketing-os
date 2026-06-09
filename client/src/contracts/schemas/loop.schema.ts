/**
 * Loop status — is the agentic loop closed?
 *
 * The six stages (plan→allocate→execute→test→measure→learn) each carry their
 * freshness, plus the queryable health summary. Makes the loop visibly closed.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';

export const LoopStageSchema = z.enum(['PLAN', 'ALLOCATE', 'EXECUTE', 'TEST', 'MEASURE', 'LEARN']);
export const StageStateSchema = z.enum(['ACTIVE', 'IDLE', 'STALE']);
export const LoopHealthSchema = z.enum(['HEALTHY', 'DEGRADED', 'STALLED']);

export const StageStatusSchema = z.object({
  stage: LoopStageSchema,
  state: StageStateSchema,
  lastAt: z.string().nullable(),
  count: z.number(),
});

export const LoopStatusSchema = z.object({
  stageStatus: z.array(StageStatusSchema),
  closed: z.boolean(),
  staleStages: z.array(LoopStageSchema),
  loopHealth: LoopHealthSchema,
  lastRunAt: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  intervalMs: z.number().nullable(),
});

export type LoopStage = z.infer<typeof LoopStageSchema>;
export type StageState = z.infer<typeof StageStateSchema>;
export type LoopHealth = z.infer<typeof LoopHealthSchema>;
export type StageStatus = z.infer<typeof StageStatusSchema>;
export type LoopStatus = z.infer<typeof LoopStatusSchema>;

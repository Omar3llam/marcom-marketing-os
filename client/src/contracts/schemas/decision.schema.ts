/**
 * Decision Graph Schema — Entity → Decision → Outcome → Memory
 *
 * Mirrors the Phase 1 Prisma decision graph. This is the layer that
 * makes Lumi an operating system rather than a dashboard: every
 * verdict on an entity produces a measurable Outcome, which distills
 * into reusable Memory.
 *
 * Distinct from the legacy execution-engine `DecisionMemory` model —
 * these are the marketing decision-graph contracts.
 *
 * Source of truth: schemas (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { EntityLevelSchema } from './entity.schema';

/** Marketing decision verdict. Phase 2 adds REALLOCATE + REFRESH. */
export const VerdictSchema = z.enum(['KILL', 'HOLD', 'SCALE', 'WATCH', 'REALLOCATE', 'REFRESH']);

/**
 * Workflow status of a decision — all FIVE the backend writes.
 *
 * B8-01 — this declared three. The two it omitted are the two a decision ends
 * in once it stops being someone's problem: SUPERSEDED (a newer verdict
 * replaced it) and RESOLVED (C-02 — the condition ended with no human act).
 * PROPOSED / EXECUTED / DISMISSED describe a decision that is still LIVE, so
 * the omission was not an edge case; it was every historical decision.
 *
 * The consequence is the one named under `confidence` below: a strict enum
 * fails the WHOLE parse. A history surface fed by this schema would not have
 * rendered a blank status — it would have rendered nothing, reporting an
 * account with no decisions. Failure is not emptiness.
 *
 * Widening is not opening: an unrecognised status still fails, so contract
 * drift is still reported rather than absorbed.
 */
export const DecisionStatusSchema = z.enum([
  'PROPOSED', 'EXECUTED', 'DISMISSED', 'SUPERSEDED', 'RESOLVED',
]);

export const DecisionSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  entityId: z.string().min(1),
  entityLevel: EntityLevelSchema,
  verdict: VerdictSchema,
  // C-16 — NULLABLE, because the column is. `decisions.confidence` used to be
  // NOT NULL and the writer satisfied it with an invented `?? 0.5`; dropping
  // both means null now means "the engine measured no confidence for this
  // call". No production path writes one today, which is exactly why this must
  // be declared rather than left: a strict schema does not blank one field on
  // an unexpected null, it fails the whole parse and takes the surface with it.
  confidence: z.number().min(0).max(1).nullable(),
  diagnosis: z.string(),
  rootCause: z.string().nullish(),
  status: DecisionStatusSchema.default('PROPOSED'),
  createdAt: z.coerce.date(),
});

/**
 * One row of the THEN destination's list (`GET /api/lumi/decisions`).
 *
 * B8-03 — NOT `DecisionSchema`. That one describes a whole Decision and
 * requires `workspaceId`, which the list projection deliberately omits: a row
 * the caller already scoped by workspace does not restate it. A list row is its
 * own shape, and saying so keeps the destination free to carry less than the
 * detail surface does.
 *
 * `decisionClass` is NULLABLE but always ADMITTED. C-13's F-6 is the reason it
 * is spelled out here: C-10 published the class and the client's zod schema
 * stripped it, so the cure could never have had a consumer. A row's class fills
 * B8-02's "why credible" slot, and a schema that dropped it would empty that
 * slot silently.
 */
export const DecisionHistoryRowSchema = z.object({
  id: z.string().min(1),
  decisionClass: z.string().nullable(),
  entityId: z.string().nullish(),
  entityLevel: EntityLevelSchema,
  verdict: VerdictSchema,
  status: DecisionStatusSchema,
  diagnosis: z.string(),
  rootCause: z.string().nullish(),
  // C-16 — the same absence the detail surface admits. Null means the engine
  // measured no confidence, and it must never render as a number.
  confidence: z.number().min(0).max(1).nullable(),
  createdAt: z.coerce.date(),
});

/**
 * A page of decision history.
 *
 * `total` is the whole population and is INDEPENDENT of `decisions.length` —
 * B8-01's forbidden inference, held at the parse boundary: a capped list is not
 * a capped count. `nextCursor` is null on the last page, never an empty string.
 */
export const DecisionHistoryPageSchema = z.object({
  decisions: z.array(DecisionHistoryRowSchema),
  total: z.number().int().min(0),
  nextCursor: z.string().nullable(),
});

export const OutcomeSnapshotSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  decisionId: z.string().min(1),
  entityId: z.string().min(1),
  entityLevel: EntityLevelSchema,

  // Realized result — minor units.
  spendDeltaMinor: z.number().int().nullish(),
  revenueDeltaMinor: z.number().int().nullish(),
  roasDelta: z.number().nullish(),

  windowStart: z.coerce.date().nullish(),
  windowEnd: z.coerce.date().nullish(),
  sustained: z.boolean().nullish(),
  createdAt: z.coerce.date(),
});

export const DecisionMemoryEntrySchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  decisionId: z.string().nullish(),
  entityId: z.string().nullish(),
  actionType: z.string().nullish(),
  rationale: z.string(),
  isSustainable: z.boolean().nullish(),
  impactDurationHrs: z.number().int().nullish(),
  createdAt: z.coerce.date(),
});

/**
 * A verdict at one entity level — the unit of the multi-level
 * drill-down (a campaign can be SCALE while a child ad set is KILL).
 */
export const LevelVerdictSchema = z.object({
  entityId: z.string().min(1),
  entityLevel: EntityLevelSchema,
  verdict: VerdictSchema,
  // C-16 — see DecisionSchema above. A level verdict carries the same figure
  // from the same engine, so it accepts the same absence.
  confidence: z.number().min(0).max(1).nullable(),
  rationale: z.string().nullish(),
});

export type LevelVerdict = z.infer<typeof LevelVerdictSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type OutcomeSnapshot = z.infer<typeof OutcomeSnapshotSchema>;
export type DecisionMemoryEntry = z.infer<typeof DecisionMemoryEntrySchema>;

export type DecisionHistoryRow = z.infer<typeof DecisionHistoryRowSchema>;
export type DecisionHistoryPage = z.infer<typeof DecisionHistoryPageSchema>;

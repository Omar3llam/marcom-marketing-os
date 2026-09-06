/**
 * The Decision detail payload — `GET /api/lumi/decisions/:id` (C-11, B8-04).
 *
 * The densest thing Lumi publishes, and the one whose fields are least safe to
 * drop: C-13's F-6 caught a client schema stripping `decisionClass` after C-10
 * had published it, which left that contract with no possible consumer. Every
 * field the route emits is declared here for that reason.
 *
 * Source of truth: schemas (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { EntityLevelSchema } from './entity.schema';
import { VerdictSchema, DecisionStatusSchema } from './decision.schema';

/**
 * C-06's five knowledge tokens, as they arrive on the wire.
 *
 * Declared as an ENUM rather than a string: an unrecognised token is contract
 * drift and must be reported, not absorbed. The canonical vocabulary lives in
 * `@marcom/runtime-contracts`; this mirrors its VALUES for parsing, and the
 * client branches on it through `design-system/states/absence.js`.
 */
export const KnowledgeTokenSchema = z.enum([
  'KNOWN', 'COULD_NOT_LOOK', 'NOT_ENOUGH', 'NOTHING_THERE', 'CANNOT_ASK',
]);

/**
 * One committed field: what was frozen, and what we know about it.
 *
 * The token is not decoration. A null `hypotheses` means "this class never
 * records reasoning" on a Guardrail and "we could not establish it" on a
 * Signal — the same spelling, two different facts — and only `knowledge`
 * separates them. C-11 declared capture PER FIELD for exactly this reason.
 */
export const CommittedFieldSchema = z.object({
  value: z.unknown(),
  knowledge: KnowledgeTokenSchema,
});

/** The seven fields whose null is ambiguous (C-11's COMMITTED_FIELDS). */
export const CommittedBlockSchema = z.object({
  ctrAtDecision:     CommittedFieldSchema,
  roasAtDecision:    CommittedFieldSchema,
  objective:         CommittedFieldSchema,
  channel:           CommittedFieldSchema,
  hypotheses:        CommittedFieldSchema,
  counterfactuals:   CommittedFieldSchema,
  evidenceReference: CommittedFieldSchema,
});

/**
 * The memory measured AT COMMITMENT (R-6, C-16).
 *
 * Patterns are carried BY VALUE — statement and all — because a stored
 * `patternId` would start reporting a sentence the Decision never saw once a
 * later sweep rewrote the pattern row. `passthrough` is deliberate: provenance
 * is a stored JSON document, and a strict object would fail the whole parse if
 * the writer ever adds a field.
 */
export const MemoryProvenanceSchema = z.object({
  factor: z.number().nullish(),
  applied: z.boolean().nullish(),
  patterns: z.array(z.object({
    patternId: z.string().nullish(),
    statement: z.string().nullish(),
    accuracy: z.number().nullish(),
    effectiveSupport: z.number().nullish(),
  }).passthrough()).nullish(),
}).passthrough();

export const DecisionDetailSchema = z.object({
  id: z.string().min(1),
  decisionClass: z.string().nullable(),
  entityId: z.string().nullish(),
  entityLevel: EntityLevelSchema,
  decidedAt: z.coerce.date(),

  // What Lumi believed. C-16 — confidence is nullable because the column is.
  verdict: VerdictSchema,
  confidence: z.number().min(0).max(1).nullable(),
  diagnosis: z.string(),
  rootCause: z.string().nullish(),
  status: DecisionStatusSchema,

  // Did a human look, and did they carry it somewhere they could act? The gap
  // between the two is how long the operator took to NOT act.
  explainedAt: z.coerce.date().nullable(),
  intentAt: z.coerce.date().nullable(),

  // The closure axes, STATED rather than omitted — null says "we looked, and it
  // has not happened", which is a different claim from an absent key.
  humanExecutedAt: z.coerce.date().nullable(),
  platformExecutedAt: z.coerce.date().nullable(),
  dismissedAt: z.coerce.date().nullable(),
  resolvedAt: z.coerce.date().nullable(),
  resolution: z.string().nullable(),
  confidenceDelta: z.number().nullable(),
  closureReason: z.string().nullable(),

  // What the HUMAN decided about what Lumi decided (R-13). Null is never
  // CONFIRM and never OTHER — the absence of an opinion is not an opinion.
  humanResponse: z.string().nullable(),
  humanReasonCode: z.string().nullable(),
  humanReasonNote: z.string().nullable(),
  humanRespondedAt: z.coerce.date().nullable(),

  // Guardrail identity travels flat; its null is unambiguous because the class
  // is published beside it.
  guardrailRuleId: z.string().nullable(),
  openHitKey: z.string().nullable(),

  // B8-01 — the Decision's OWN historical truth, not Memory (R-5 keeps the two
  // objects apart and forbids reconciling their divergence).
  memoryProvenance: MemoryProvenanceSchema.nullable(),
  baseConfidence: z.number().min(0).max(1).nullable(),
  memoryStatus: z.string().nullable(),

  committed: CommittedBlockSchema,
});

export const DecisionDetailResponseSchema = z.object({
  decision: DecisionDetailSchema,
});

export type KnowledgeToken = z.infer<typeof KnowledgeTokenSchema>;
export type CommittedField = z.infer<typeof CommittedFieldSchema>;
export type DecisionDetail = z.infer<typeof DecisionDetailSchema>;

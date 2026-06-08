/**
 * Evidence-bound figure/claim — the Phase-8 honesty primitive
 *
 * THE GUARD, encoded for the reporting layer: a Marketing OS report drifts
 * into "a weaker Looker" the moment it shows a number it can't defend. So
 * EVERY figure in a narrative is bound to a real row — `evidenceRef` is a
 * non-empty id (Decision/Outcome/AllocationPlan/IncrementalityTest/Goal/
 * blended channel). A bare number fails parsing. Mirrors the Phase-7
 * Attributed wrapper: honesty enforced at the boundary.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';

export const EvidenceKindSchema = z.enum([
  'DECISION', 'OUTCOME', 'ALLOCATION', 'INCREMENTALITY', 'GOAL', 'BLENDED',
]);

// A number that MUST cite the real row it came from. evidenceRef is required
// and non-empty — this is what makes "zero hallucinated numbers" structural.
export const FigureSchema = z.object({
  value: z.number(),
  unit: z.string(),
  evidenceRef: z.string().min(1),
  kind: EvidenceKindSchema.nullish(),
});

export const ClaimSchema = z.object({
  text: z.string(),
  figures: z.array(FigureSchema),
  tier: z.enum(['exec', 'detail']).optional(),
  proven: z.boolean().optional(),
});

export const NarrativeSectionSchema = z.object({
  key: z.string(),
  title: z.string(),
  claims: z.array(ClaimSchema),
});

export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;
export type Figure = z.infer<typeof FigureSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type NarrativeSection = z.infer<typeof NarrativeSectionSchema>;

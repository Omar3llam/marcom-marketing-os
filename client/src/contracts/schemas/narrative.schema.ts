/**
 * Stakeholder narrative — the reasoned report (not a dashboard)
 *
 * A persisted weekly/monthly narrative: prose grounded in real rows, plus a
 * report-level confidence that is ITSELF defensible — it carries its component
 * breakdown, never a bare "91%". Partial data → an honestly lower score.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { NarrativeSectionSchema } from './evidenceClaim.schema';

export const NarrativePeriodSchema = z.enum(['WEEKLY', 'MONTHLY']);
export const NarrativeAudienceSchema = z.enum(['STRATEGIST', 'BUYER', 'LEADERSHIP']);

// One driver of the report confidence — weight × a 0..1 coverage value.
export const ConfidenceComponentSchema = z.object({
  key: z.string(),
  weight: z.number(),
  value: z.number(),
});

// The report confidence — rejects a bare score with no component breakdown.
export const ReportConfidenceSchema = z.object({
  score: z.number().min(0).max(100),
  label: z.enum(['LOW', 'MODERATE', 'HIGH']),
  components: z.array(ConfidenceComponentSchema).min(1),
});

export const StakeholderNarrativeSchema = z.object({
  id: z.string().optional(),
  period: NarrativePeriodSchema,
  audience: NarrativeAudienceSchema,
  periodStart: z.union([z.string(), z.date()]).nullish(),
  periodEnd: z.union([z.string(), z.date()]).nullish(),
  headline: z.string(),
  reportConfidence: ReportConfidenceSchema,
  sections: z.array(NarrativeSectionSchema),
  evidenceRefs: z.array(z.string()),
});

export type NarrativePeriod = z.infer<typeof NarrativePeriodSchema>;
export type NarrativeAudience = z.infer<typeof NarrativeAudienceSchema>;
export type ConfidenceComponent = z.infer<typeof ConfidenceComponentSchema>;
export type ReportConfidence = z.infer<typeof ReportConfidenceSchema>;
export type StakeholderNarrative = z.infer<typeof StakeholderNarrativeSchema>;

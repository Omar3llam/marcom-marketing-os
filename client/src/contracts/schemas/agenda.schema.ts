/**
 * Agenda item — a single proposal in the unified home
 *
 * Phase 9: Lumi detects, the human confirms. Every agenda item carries the
 * human verb (`humanAction`) and a reference to the real row behind it — never
 * an auto-action.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';

export const AgendaBandSchema = z.enum(['BUYER', 'STRATEGIST']);
export const AgendaTypeSchema = z.enum([
  'VERDICT', 'REALLOCATION', 'TEST', 'PLAN_ADJUSTMENT', 'PACING', 'FATIGUE',
]);
export const AgendaSeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export const HumanActionSchema = z.enum(['confirm', 'review', 'adjust']);

export const AgendaItemSchema = z.object({
  id: z.string(),
  band: AgendaBandSchema,
  type: AgendaTypeSchema,
  title: z.string(),
  rationale: z.string(),
  severity: AgendaSeveritySchema,
  evidenceRef: z.string().nullable(),
  humanAction: HumanActionSchema,
  entityId: z.string().nullable(),
  // Priority-to-act (1-10) — the same score the Campaigns page shows; null when
  // the item isn't a scored campaign (fatigue/pacing/test, or an unscored verdict).
  impactScore: z.number().nullable(),
});

export type AgendaBand = z.infer<typeof AgendaBandSchema>;
export type AgendaType = z.infer<typeof AgendaTypeSchema>;
export type AgendaSeverity = z.infer<typeof AgendaSeveritySchema>;
export type HumanAction = z.infer<typeof HumanActionSchema>;
export type AgendaItem = z.infer<typeof AgendaItemSchema>;

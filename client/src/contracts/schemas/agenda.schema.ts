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
  // C-10 — which KIND of decision backs this item. SIGNAL and GUARDRAIL both
  // arrive as `type: VERDICT` with the same title, severity and human verb, so
  // without this the client cannot tell a performance verdict from a policy
  // breach. Null when the item is not decision-derived, predates the column, or
  // carries a class this bundle has never heard of — all three deserve silence.
  //
  // C-13/F-6 — it was published from the day C-10 shipped and DECLARED here
  // only now. `z.object()` strips what it does not declare and `useHome` stores
  // the parsed object, so the field reached the browser and never reached a
  // component. `agendaFieldParity.contract.test.js` is the ratchet that fails
  // the next time a field is added on one side only.
  decisionClass: z.string().nullable().optional(),
  // C-13 — WHICH live row an item is about, when its class contains more than
  // one kind. Today that is Experiment: an A/B test and a causal holdout are
  // one class in two tables on two pages.
  subjectRef: z.object({ kind: z.string(), id: z.string() }).nullable().optional(),
});

export type AgendaBand = z.infer<typeof AgendaBandSchema>;
export type AgendaType = z.infer<typeof AgendaTypeSchema>;
export type AgendaSeverity = z.infer<typeof AgendaSeveritySchema>;
export type HumanAction = z.infer<typeof HumanActionSchema>;
export type AgendaItem = z.infer<typeof AgendaItemSchema>;

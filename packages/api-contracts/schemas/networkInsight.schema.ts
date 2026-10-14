/**
 * NetworkInsight Schema — Phase 5 gated cross-account layer
 *
 * Mirrors the networkEngine output. The network is honest by
 * construction: insights are k-anonymity gated, carry an accuracy BAND
 * (never a point claim), and expose only an anonymized contributor COUNT
 * (never a workspace id). Below the gate it returns INSUFFICIENT_DATA;
 * un-opted workspaces get NOT_CONSENTED.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 *
 * ── ACROSS Tier 1 · TWO LEVELS, TWO VOCABULARIES ────────────────────────────
 * This file used to declare ONE status enum and use it at both levels. It was
 * wrong in both directions, measured against the publishers:
 *
 *   response level   NetworkService.js + the briefing route's own catch
 *                    → OK · NOT_CONSENTED · UNAVAILABLE
 *   insight level    networkEngine.js
 *                    → OK · INSUFFICIENT_DATA
 *
 * The single enum accepted INSUFFICIENT_DATA at response level (never sent
 * there) and rejected UNAVAILABLE (sent on two paths), so a CONSENTED workspace
 * whose cohort could not be established failed the WHOLE briefing parse.
 *
 * `src/tests/networkVocabularyParity.test.js` extracts both sets from those
 * publishers and asserts these enums equal them — a hand-kept list here would
 * be a second declaration of the vocabulary, which is the defect itself.
 */

import { z } from 'zod';
import { PatternKindSchema } from './accountPattern.schema';

/**
 * What the RESPONSE can say. The three stay separate because only one of them
 * is the operator's to act on — the server's own comment: "NOT_CONSENTED has a
 * button, INSUFFICIENT_DATA needs more peers, and this one needs us to fix
 * something."
 */
export const NetworkResponseStatusSchema = z.enum(['OK', 'NOT_CONSENTED', 'UNAVAILABLE']);

/** What ONE cohort insight can say. A finding about a cohort, not about consent. */
export const NetworkInsightStatusSchema = z.enum(['OK', 'INSUFFICIENT_DATA']);

// One gated cohort insight. `accuracyBand`/`holdRate` present only when OK.
export const NetworkInsightSchema = z.object({
  status: NetworkInsightStatusSchema,
  cohortTag: z.string().optional(),
  kind: PatternKindSchema.optional(),
  metric: z.string().optional(),
  contributingWorkspaces: z.number().int().optional(), // anonymized count only
  needed: z.number().int().optional(),
  threshold: z.number().optional(),
  holdRate: z.number().optional(),
  accuracyBand: z.tuple([z.number(), z.number()]).optional(), // [lo, hi] — never a point
  statement: z.string().optional(),
});

export const NetworkResponseSchema = z.object({
  status: NetworkResponseStatusSchema,
  // C-06 · the epistemic token the ROUTE attaches beside the status, so a
  // client that has never heard of NETWORK_STATUS can still tell the three
  // apart. It was undeclared here, and zod strips what a schema does not
  // declare — C-13's F-6: a published field removed by the client.
  knowledge: z.string().optional(),
  cohortTag: z.string().optional(),
  insights: z.array(NetworkInsightSchema).optional(),
});

export type NetworkResponseStatus = z.infer<typeof NetworkResponseStatusSchema>;
export type NetworkInsightStatus = z.infer<typeof NetworkInsightStatusSchema>;
export type NetworkInsight = z.infer<typeof NetworkInsightSchema>;
export type NetworkResponse = z.infer<typeof NetworkResponseSchema>;

/**
 * TestReadout Schema — Phase 4 honest winner readout
 *
 * Mirrors the testReadoutEngine output. The readout declares a winner
 * (or refuses to) with an honestly labeled confidence, and a REFRESH /
 * SCALE verdict only when the call is statistically warranted.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { ConfidenceLabelSchema } from './testExperiment.schema';

// Verdict a concluded test can produce (null when not warranted).
export const TestVerdictSchema = z.enum(['SCALE', 'REFRESH']).nullable();

export const TestReadoutSchema = z.object({
  winnerLabel: z.string().nullable(),
  winnerVariantId: z.string().nullable(),
  lift: z.number(),
  confidence: z.number(),
  confidenceLabel: ConfidenceLabelSchema,
  sampleNote: z.string(),
  verdict: TestVerdictSchema,
  rationale: z.string(),
  metric: z.string(),
});

// POST /api/lumi/tests/:id/conclude response.
export const ConcludeTestResponseSchema = z.object({
  workspaceId: z.string().nullish(),
  readout: TestReadoutSchema,
  memoryId: z.string().nullish(),
  decisionId: z.string().nullable(),
  verdict: TestVerdictSchema,
  actionType: z.string().nullable(),
});

export type TestVerdict = z.infer<typeof TestVerdictSchema>;
export type TestReadout = z.infer<typeof TestReadoutSchema>;
export type ConcludeTestResponse = z.infer<typeof ConcludeTestResponseSchema>;

/**
 * Decision Accuracy Schema — the Phase-X Proof Engine contract
 *
 * The proof layer over the whole system: does "Learn" actually improve decision
 * quality, or just store memories? The honest reading is encoded here —
 * calibration (ECE/Brier) is the headline (not raw accuracy); immature outcomes
 * are excluded from coverage (never counted as failures); a claim is suppressed
 * unless `coverage.verdict === RELIABLE` (the `surface` carries the gate).
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';
import { isKnownCurrency } from '@/lib/monetaryCurrency.js';

export const CoverageVerdictSchema = z.enum(['RELIABLE', 'THIN', 'INSUFFICIENT_DATA']);
export const LiftStatusSchema = z.enum(['IMPROVING', 'FLAT', 'DEGRADING', 'INSUFFICIENT_DATA']);
export const CalibrationDirectionSchema = z.enum(['OVERCONFIDENT', 'UNDERCONFIDENT', 'CALIBRATED']);

// One populated interval of the selected grid. Test/config overrides may change
// minBinCount, so admission requires real observations, not a hardcoded floor.
const ProbabilitySchema = z.number().finite().min(0).max(1);
export const ReliabilityBinSchema = z.object({
  band: z.string(),
  predicted: ProbabilitySchema,
  observed: ProbabilitySchema,
  count: z.number().int().positive(),
  gap: ProbabilitySchema,
});

const PopulationSpanSchema = z.object({
  basis: z.literal('DECISION_ISSUED_AT'),
  from: z.string().datetime(), to: z.string().datetime(),
}).refine(span => Date.parse(span.from) <= Date.parse(span.to), 'Issuance span must be ordered');

export const CalibrationSchema = z.object({
  bins: z.array(ReliabilityBinSchema),
  binEdges: z.array(ProbabilitySchema), // grid geometry, including unoccupied intervals
  expectedCalibrationError: ProbabilitySchema.nullable(),
  brierScore: ProbabilitySchema.nullable(),
  accuracy: ProbabilitySchema.nullable(), // raw success rate — SECONDARY
  direction: CalibrationDirectionSchema,
  sampleSize: z.number().int().nonnegative(),
  populationSpan: PopulationSpanSchema.nullable(),
}).superRefine((calibration, ctx) => {
  const empty = calibration.sampleSize === 0;
  if (empty !== (calibration.populationSpan === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Scored population requires its issuance span; empty population has none' });
  }
  // Admission checks the published sample; it does not invent a replacement.
  if (calibration.bins.reduce((sum, bin) => sum + bin.count, 0) !== calibration.sampleSize) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Reliability observations must equal the scored sample size' });
  }
  if ([calibration.expectedCalibrationError, calibration.brierScore, calibration.accuracy].some(value => (value === null) !== empty)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Calibration aggregates are measured exactly when the population is nonempty' });
  }
});

const WindowSchema = z.object({
  calibrationError: z.number(),
  accuracy: z.number(),
  sampleSize: z.number().int().nonnegative(),
  span: z.object({ from: z.string(), to: z.string() }),
});

export const AccountLiftSchema = z.object({
  earlyWindow: WindowSchema.nullable(),
  recentWindow: WindowSchema.nullable(),
  calibrationImprovementPct: z.number().nullable(), // null below minSample — never an ungated %
  status: LiftStatusSchema,
});

export const VelocityPeriodSchema = z.object({
  label: z.string(),
  calibrationError: z.number().nullable(),
  sampleSize: z.number().int().nonnegative(),
  includedInTrend: z.boolean(), // server-selected membership; never inferred from n
});

export const VelocitySchema = z.object({
  periods: z.array(VelocityPeriodSchema),
  trend: LiftStatusSchema,
  slope: z.number().nullable(),
});

export const AccuracyCoverageSchema = z.object({
  totalDecisions: z.number().int().nonnegative(),
  scored: z.number().int().nonnegative(),
  unscorable: z.number().int().nonnegative(),
  pendingMaturation: z.number().int().nonnegative(),
  dismissed: z.number().int().nonnegative(),
  notAPrediction: z.number().int().nonnegative(),
  scoredFraction: z.number(),
  verdict: CoverageVerdictSchema,
  note: z.string(),
});

// The gated surface payload — calibration numbers are null unless RELIABLE.
export const AccuracySurfaceSchema = z.object({
  gated: z.boolean(),
  headline: z.string(),
  status: LiftStatusSchema.nullable(),
  calibrationErrorPct: z.number().nullable(),
  improvementPct: z.number().nullable(),
  scored: z.number().int().nonnegative(),
  needed: z.number().int().nonnegative(),
});

export const DecisionAccuracySchema = z.object({
  accountLift: AccountLiftSchema,
  calibration: CalibrationSchema,
  velocity: VelocitySchema,
  coverage: AccuracyCoverageSchema,
});

// ── Outcome recording (the Proof Engine's human-asserted WRITE path) ──
// GET /api/lumi/decisions/pending-outcomes → EXECUTED decisions still missing
// an outcome, plus the workspace currency (so the form converts major→minor).
export const PendingOutcomeSchema = z.object({
  id: z.string(),
  verdict: z.string(),
  confidence: z.number(),
  diagnosis: z.string(),
  entityId: z.string(),
  entityLevel: z.string(),
  createdAt: z.string(),
});

export const PendingOutcomesResponseSchema = z.object({
  workspaceId: z.string(),
  decisions: z.array(PendingOutcomeSchema),
  currency: z.string(),
});

export type PendingOutcome = z.infer<typeof PendingOutcomeSchema>;
export type PendingOutcomesResponse = z.infer<typeof PendingOutcomesResponseSchema>;

// ── Observed evidence (B5-01X' · the READ side of outcome review) ────
// GET /api/lumi/decisions/:id/outcome-evidence → what Lumi observed over the
// comparison policy's baseline and observation windows. It is EVIDENCE, never
// an outcome: no field here says whether the decision was correct, and the
// operator's judgement is still recorded through POST …/outcome.
//
// Seven states, none of them collapsible into another. `NOT_OBSERVED` (we
// looked and saw nothing) and `UNSUPPORTED` (we have no way to look) and
// `UNAVAILABLE` (the read failed) mean three different things to the person
// reading the screen, and only one of them is about their account.
export const OutcomeEvidenceStatusSchema = z.enum([
  'MEASURABLE', 'NOT_OBSERVED', 'AMBIGUOUS', 'NOT_MEASURABLE',
  'INSUFFICIENT_COVERAGE', 'UNSUPPORTED', 'UNAVAILABLE',
]);

export const EvidenceCoverageSchema = z.object({
  required: z.number(),
  observed: z.number(),
  // The exact dates nobody reported. A count cannot tell an operator which day
  // to go and look at, so the dates travel rather than the number alone.
  missing: z.array(z.string()),
  complete: z.boolean(),
});

const EvidenceCurrencySchema = z.string().refine(isKnownCurrency, 'Unsupported evidence currency').nullable();
const EvidenceCurrencyProvenanceSchema = z.literal('PLATFORM_REPORTED').nullable();
const hasPublishedNumber = (value: { spendMinor: number | null; revenueMinor: number | null; roas: number | null }) =>
  [value.spendMinor, value.revenueMinor, value.roas].some(number => number !== null);

export const EvidenceWindowSchema = z.object({
  days: z.array(z.string()),
  // Nullable throughout: an unobserved window has no total, and 0 would read as
  // "it spent nothing" rather than "we have no rows".
  spendMinor: z.number().finite().nullable(),
  revenueMinor: z.number().finite().nullable(),
  roas: z.number().finite().nullable(),
  currency: EvidenceCurrencySchema,
  currencyProvenance: EvidenceCurrencyProvenanceSchema,
  coverage: EvidenceCoverageSchema,
  refs: z.array(z.object({
    id: z.string(),
    day: z.string(),
    observedAt: z.string().nullable(),
  })),
}).superRefine((window, ctx) => {
  if ((hasPublishedNumber(window) && (window.currency === null || window.currencyProvenance === null))
    || (window.currency === null) !== (window.currencyProvenance === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Published window money requires its own authoritative denomination' });
  }
  if (window.roas !== null && (window.spendMinor === null || window.spendMinor <= 0 || window.revenueMinor === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Published ROAS requires available monetary parts and positive spend' });
  }
});

export const OutcomeEvidenceResponseSchema = z.object({
  workspaceId: z.string(),
  decisionId: z.string(),
  entityId: z.string(),
  entityLevel: z.string(),
  verdict: z.string(),
  interventionAt: z.string(),
  interventionDay: z.string(),
  source: z.string().nullable(),
  status: OutcomeEvidenceStatusSchema,
  reason: z.string().nullable(),
  policy: z.object({
    comparisonWindowDays: z.number(),
    baselineWindow: z.object({ start: z.string(), end: z.string() }),
    observationWindow: z.object({ start: z.string(), end: z.string() }),
    interventionDayExcluded: z.boolean(),
  }),
  baseline: EvidenceWindowSchema.nullable(),
  observation: EvidenceWindowSchema.nullable(),
  delta: z.object({
    spendMinor: z.number().finite().nullable(),
    revenueMinor: z.number().finite().nullable(),
    roas: z.number().finite().nullable(),
    currency: EvidenceCurrencySchema,
    currencyProvenance: EvidenceCurrencyProvenanceSchema,
  }),
  // Present only on AMBIGUOUS: the exact days that did not reduce to one
  // reading. The window holding them reports null totals, because a sum over an
  // arbitrarily-chosen tied row is not reproducible between two reads.
  ambiguousDays: z.array(z.string()).optional(),
}).superRefine((evidence, ctx) => {
  const { baseline, observation, delta, status } = evidence;
  const numbers = hasPublishedNumber(delta);
  if (numbers && (delta.currency === null || delta.currencyProvenance === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['delta'], message: 'Published delta requires its own authoritative denomination' });
  }
  if (!numbers && (delta.currency !== null || delta.currencyProvenance !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['delta'], message: 'Absent delta has no denomination' });
  }
  if (status !== 'MEASURABLE' && numbers) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['delta'], message: 'Refused or incomplete evidence cannot publish a delta' });
  }
  // Validate agreement of server-published units; never reconstruct totals,
  // ratios, differences, coverage or comparison eligibility from daily rows.
  if (status === 'MEASURABLE' && (!baseline?.currency || !observation?.currency
    || baseline.currencyProvenance !== 'PLATFORM_REPORTED' || observation.currencyProvenance !== 'PLATFORM_REPORTED'
    || baseline.currency !== observation.currency || (numbers && delta.currency !== baseline.currency))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Measurable evidence must publish one authoritative comparison denomination' });
  }
});

export type OutcomeEvidenceStatus = z.infer<typeof OutcomeEvidenceStatusSchema>;
export type EvidenceWindow = z.infer<typeof EvidenceWindowSchema>;
export type OutcomeEvidenceResponse = z.infer<typeof OutcomeEvidenceResponseSchema>;

export type CoverageVerdict = z.infer<typeof CoverageVerdictSchema>;
export type LiftStatus = z.infer<typeof LiftStatusSchema>;
export type CalibrationDirection = z.infer<typeof CalibrationDirectionSchema>;
export type ReliabilityBin = z.infer<typeof ReliabilityBinSchema>;
export type Calibration = z.infer<typeof CalibrationSchema>;
export type AccountLift = z.infer<typeof AccountLiftSchema>;
export type VelocityPeriod = z.infer<typeof VelocityPeriodSchema>;
export type Velocity = z.infer<typeof VelocitySchema>;
export type AccuracyCoverage = z.infer<typeof AccuracyCoverageSchema>;
export type AccuracySurface = z.infer<typeof AccuracySurfaceSchema>;
export type DecisionAccuracy = z.infer<typeof DecisionAccuracySchema>;

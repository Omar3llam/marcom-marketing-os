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

export const CoverageVerdictSchema = z.enum(['RELIABLE', 'THIN', 'INSUFFICIENT_DATA']);
export const LiftStatusSchema = z.enum(['IMPROVING', 'FLAT', 'DEGRADING', 'INSUFFICIENT_DATA']);
export const CalibrationDirectionSchema = z.enum(['OVERCONFIDENT', 'UNDERCONFIDENT', 'CALIBRATED']);

// One row of the reliability table — bins below minBinCount are collapsed away.
export const ReliabilityBinSchema = z.object({
  band: z.string(),
  predicted: z.number(),
  observed: z.number(),
  count: z.number().int().nonnegative(),
  gap: z.number(),
});

export const CalibrationSchema = z.object({
  bins: z.array(ReliabilityBinSchema),
  binEdges: z.array(z.number()),
  expectedCalibrationError: z.number().nullable(), // ECE — the headline
  brierScore: z.number().nullable(),               // binning-free backstop
  accuracy: z.number().nullable(),                 // raw success rate — SECONDARY
  direction: CalibrationDirectionSchema,
  sampleSize: z.number().int().nonnegative(),
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
  calibrationError: z.number(),
  sampleSize: z.number().int().nonnegative(),
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

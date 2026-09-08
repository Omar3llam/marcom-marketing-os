/**
 * Connector Campaigns Schema — PARITY-04
 *
 * The SUBJECT axis's two reads:
 *   GET /api/lumi/entities/campaigns   the connector campaign rows
 *   GET /api/lumi/entities/verdicts    the engine's verdict per row, + gatedOut
 *
 * ── THE DEFECT THIS CONTRACT CLOSES ─────────────────────────────────────────
 *   setVerdicts(Array.isArray(res.data?.verdicts) ? res.data.verdicts : []);
 *
 * A 200 whose shape changed became an empty array, with `error` null and
 * `loading` false. Every campaign then lands in UNSCORED and the whole account
 * reads "Needs Data" — while `gatedOut`, which carries the C-07 instruction
 * saying WHY a campaign cannot be scored, vanishes the same way. The operator is
 * told there is a problem and not what it is, by a request that succeeded.
 *
 *     HTTP success ≠ semantic success
 *
 * ── ⚠️ NOT entity.schema.ts ─────────────────────────────────────────────────
 * `entity.schema.ts` describes the PRISMA ENTITY GRAPH — Account → Campaign →
 * AdSet → Ad → Creative, as nodes. This file describes the FLATTENED HTTP WIRE
 * shape `toCampaignRow` produces, which is a different thing with different
 * fields. Reaching for `CampaignNodeSchema` here would produce a contract that
 * does not match the wire. The two are deliberately kept apart.
 *
 * ── WHAT IS REQUIRED ────────────────────────────────────────────────────────
 * A field a CLAIM reads (FE-03), and nothing else:
 *   · the envelope's collections — their absence IS the defect
 *   · a row's identity spine — a row that cannot be identified cannot render
 * Everything else the serializer emits is declared but nullish, because
 * null-when-absent is that serializer's deliberate contract and a schema that
 * rejected it would turn honest absence into an outage.
 *
 * Unknown keys are stripped, never rejected: an additive server change may not
 * blank a surface.
 */

import { z } from 'zod';

/**
 * ⚠️ THE ONLY CLOSED VOCABULARY HERE, and it is earned.
 *
 * B8-01: a strict enum fails the whole parse, so arming one means owning the
 * proof it admits the truth. `src/tests/connectorCampaignsParity.test.js` proves
 * this equals the engine's own frozen `VERDICT` object in both directions, AND
 * asserts the deploy model that makes strictness safe — render.yaml builds the
 * client from the same commit as the server, so a new verdict cannot reach a
 * browser ahead of the client that admits it.
 *
 * `channel` and `gatedOut[].reason` stay OPEN on purpose. Channel is rendered as
 * text; an unrecognised gating reason already renders no instruction rather than
 * a guessed one (C-07), and campaignGrouping already sends an unknown verdict to
 * UNSCORED rather than dropping the row. Arming those would convert a graceful
 * degradation into a dead page.
 */
export const ConnectorVerdictValueSchema = z.enum([
  'KILL',
  'HOLD',
  'SCALE',
  'WATCH',
  'REALLOCATE',
  'REFRESH',
]);

/** One connector campaign row — `toCampaignRow` + the route's `needsRevenue`. */
export const ConnectorCampaignRowSchema = z.object({
  // ── identity spine: required ──
  entityId: z.string().min(1),
  name: z.string(),
  channel: z.string(),
  adSetCount: z.number(),

  // ── entity attributes: declared, null when the platform did not say ──
  objective: z.string().nullish(),
  externalId: z.string().nullish(),
  platformCreatedTime: z.string().nullish(),
  evidenceBasis: z.unknown().nullish(),
  evidenceRows: z.array(z.unknown()).nullish(),

  // ── metrics: null-when-absent, DISTINCT from a measured 0 ──
  spendMinor: z.number().nullish(),
  roas: z.number().nullish(),
  ctr: z.number().nullish(),
  frequency: z.number().nullish(),
  reach: z.number().nullish(),
  conversions: z.number().nullish(),
  revenueMinor: z.number().nullish(),
  impressions: z.number().nullish(),
  clicks: z.number().nullish(),
  dailyBudgetMinor: z.number().nullish(),
  actionMetrics: z.unknown().nullish(),
  currency: z.string().nullish(),
  lastDate: z.string().nullish(),

  // ── R13-C: which period the metrics describe. A measurement without a
  //    period is not a fact, so these travel with them. ──
  measurementWindow: z.string().nullish(),
  windowStart: z.string().nullish(),
  windowEnd: z.string().nullish(),
  revenueStale: z.boolean().nullish(),

  // Added by the route, not the serializer.
  needsRevenue: z.boolean().nullish(),
});

/** One engine verdict — the fields CampaignsView's projection allowlists. */
export const ConnectorVerdictRowSchema = z.object({
  // ── identity spine: required ──
  id: z.string().min(1),
  verdict: ConnectorVerdictValueSchema,

  name: z.string().nullish(),
  // C-09 — the published confidence and the two halves it is made of, each
  // carried separately so the adjustment stays auditable.
  confidence: z.number().nullish(),
  signalConfidence: z.number().nullish(),
  dataConfidence: z.number().nullish(),
  dataConfidenceDimensions: z.unknown().nullish(),
  rationale: z.string().nullish(),
  rootCause: z.unknown().nullish(),
  funnel: z.unknown().nullish(),
  counterfactuals: z.unknown().nullish(),
  hypotheses: z.unknown().nullish(),
  relativeRank: z.unknown().nullish(),
  relativeContext: z.unknown().nullish(),
  spendMinor: z.number().nullish(),
  // C-01 / C-12 — the Decision this verdict became, and what a human did about
  // it. `execution` says whether LUMI performed the mutation, which is the
  // distinction C-12 exists to keep.
  decisionId: z.string().nullish(),
  decisionVerdict: z.string().nullish(),
  execution: z.unknown().nullish(),
  humanResponse: z.string().nullish(),
  humanRespondedAt: z.string().nullish(),
  humanReasonCode: z.string().nullish(),
  humanReasonNote: z.string().nullish(),
});

/**
 * A campaign the engine refused to score, and WHY. C-07: two of the three
 * reasons share one knowledge token, so the reason is not redundant with it —
 * three reasons, three different next steps.
 */
export const GatedOutRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  reason: z.string(),
  knowledge: z.string().nullish(),
  prerequisite: z.string().nullish(),
  measurementAgeDays: z.number().nullish(),
  maxAgeDays: z.number().nullish(),
});

export const ConnectorCampaignsResponseSchema = z.object({
  workspaceId: z.string().nullish(),
  generatedAt: z.string().nullish(),
  // REQUIRED. Optional here is exactly what let a malformed 200 render as a
  // measured empty account.
  campaigns: z.array(ConnectorCampaignRowSchema),
});

export const ConnectorVerdictsResponseSchema = z.object({
  workspaceId: z.string().nullish(),
  generatedAt: z.string().nullish(),
  // REQUIRED, both of them — see above. `gatedOut` gets its own guard because
  // losing it silently removes the operator's only explanation.
  verdicts: z.array(ConnectorVerdictRowSchema),
  gatedOut: z.array(GatedOutRowSchema),
  // Absent on the service's early return (no annotated tree), so nullish rather
  // than required: a shape the server legitimately produces may not be an error.
  account: z.unknown().nullish(),
  memoryByEntityId: z.record(z.string(), z.unknown()).nullish(),
  // C-03 / C-06 — ONE status for the whole history read, carried WITH its
  // knowledge token. Additive: a payload predating them has made no claim.
  decisionHistoryStatus: z.string().nullish(),
  decisionHistoryKnowledge: z.string().nullish(),
  status: z.string().nullish(),
});

export type ConnectorVerdictValue = z.infer<typeof ConnectorVerdictValueSchema>;
export type ConnectorCampaignRow = z.infer<typeof ConnectorCampaignRowSchema>;
export type ConnectorVerdictRow = z.infer<typeof ConnectorVerdictRowSchema>;
export type GatedOutRow = z.infer<typeof GatedOutRowSchema>;
export type ConnectorCampaignsResponse = z.infer<typeof ConnectorCampaignsResponseSchema>;
export type ConnectorVerdictsResponse = z.infer<typeof ConnectorVerdictsResponseSchema>;

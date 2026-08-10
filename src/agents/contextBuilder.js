// ============================================================
// MARCOM / Lumi — Agent Context Builder (Phase 4)
// ------------------------------------------------------------
// Single source of truth for the per-campaign context blob that
// every agent (Claude, ChatGPT, future Gemini) injects into its
// system prompt. Keeps the wording identical across providers
// so A/B tests measure the *model*, not the prompt.
//
// Contract (fixed by Phase 4 spec):
//   - Always include CampaignState.stage (TESTING|SCALING|...)
//   - Always include the LAST 3 DecisionMemory entries — no more.
//     This is a hard cap to keep the prompt bounded and avoid
//     "memory soup" where stale signals dilute fresh ones.
//
// ── "NO MEMORY SUBSTRATE" IS NOT "MEMORY WITH ZERO ITEMS" ───────────────────
// Both used to render the same line to the model: "(no prior decisions on
// record)". They are different claims, and only one of them is ours to make.
//
//   []    → we read the memory source and this campaign has no history.
//           A fact about the CAMPAIGN. Fine to state.
//   null  → we could not read the memory source at all.
//           A fact about LUMI. Reporting it as "no prior decisions" tells the
//           model something about the campaign that we never established.
//
// This matters more than it looks, because the substrate is thin. The legacy
// DecisionMemory table's only production writer is temporalObserver, which
// sweeps Actions in EXECUTED_SUCCESS — and Action's only remaining producer is
// the rollback route, which needs an EXECUTED_SUCCESS Action to invert. The
// origin of both (the CSV upload service) was deleted with the upload route in
// PR #164. Same for CampaignState. So on a post-#164 workspace this read
// returns [] not because the campaign is new, but because nothing writes here.
//
// That does NOT make an empty result dishonest by itself — a workspace with
// residual pre-#164 rows is a real state, and this module cannot query "does
// this table have a producer". What it CAN do is stop collapsing the two cases:
// a read that fails now yields null and says so, instead of arriving at the
// prompt indistinguishable from a genuinely quiet campaign.
// ============================================================
import { prisma } from '../lib/prisma.js';

/**
 * Build a structured context object for a campaign.
 *
 * Returns null if no CampaignState row exists — an absence of the whole
 * context, which renderContextPrompt turns into an empty fragment (the caller
 * then decides whether to fall back to a generic prompt). That was already the
 * contract and is unchanged.
 *
 * `recent` is three-state, deliberately:
 *   Array (non-empty) — real history
 *   []                — read succeeded, this campaign has none
 *   null              — the memory source could not be read
 */
export async function buildCampaignContext(campaignId) {
  if (!campaignId) return null;

  const [state, recent] = await Promise.all([
    prisma.campaignState.findUnique({
      where: { campaignId },
      select: {
        stage: true, healthScore: true, lastAnalysis: true, workspaceId: true,
      },
    }),
    prisma.decisionMemory.findMany({
      where:   { campaignId },
      orderBy: { createdAt: 'desc' },
      take:    3,                                  // hard cap per spec
      select: {
        actionType: true, decisionRationale: true, resultStatus: true,
        deltaCtr: true, deltaRoas: true,
        impactDurationHrs: true, isSustainable: true, createdAt: true,
      },
      // null, NOT []. A failed read is "we do not know", and the renderer says
      // exactly that. Swallowing it into an empty array would put a claim about
      // the campaign's history into the prompt on the strength of a DB error.
      // It also stops a legacy-table read from taking down the agent call it was
      // only ever meant to decorate.
    }).catch(() => null),
  ]);

  if (!state) return null;
  return { state, recent };
}

/**
 * Render the structured context into a system-prompt fragment.
 * Designed to slot in *after* the role prompt and *before* the
 * task instruction.
 */
export function renderContextPrompt(ctx) {
  if (!ctx) return '';
  const { state, recent } = ctx;

  // Three states, three lines. The middle one is the one that used to be
  // missing: "we could not read the memory source" said "no prior decisions",
  // which is a claim about the campaign made on the strength of our own failure.
  const memLines = recent == null
    ? '  (decision memory unavailable — this campaign\'s history could not be read)'
    : recent.length === 0
      ? '  (no prior decisions on record)'
      : recent.map((m, i) => {
        const dCtr  = m.deltaCtr  == null ? 'n/a' : (m.deltaCtr  >= 0 ? `+${m.deltaCtr.toFixed(4)}`  : m.deltaCtr.toFixed(4));
        const dRoas = m.deltaRoas == null ? 'n/a' : (m.deltaRoas >= 0 ? `+${m.deltaRoas.toFixed(2)}` : m.deltaRoas.toFixed(2));
        const sus   = m.isSustainable === true  ? 'sustained'
                    : m.isSustainable === false ? 'regressed' : 'pending';
        return `  ${i + 1}. ${m.actionType} → ${sus} (ΔCTR ${dCtr}, ΔROAS ${dRoas}) — "${m.decisionRationale}"`;
      }).join('\n');

  return [
    '── CAMPAIGN CONTEXT ──────────────────────────',
    `Stage:        ${state.stage}`,
    `Health score: ${state.healthScore?.toFixed(2) ?? 'n/a'}`,
    `Last sweep:   ${state.lastAnalysis?.toISOString() ?? 'n/a'}`,
    'Recent decisions (most recent first, capped at 3):',
    memLines,
    '──────────────────────────────────────────────',
  ].join('\n');
}

/**
 * Convenience: fetch + render in one call.
 */
export async function getRenderedContext(campaignId) {
  const ctx = await buildCampaignContext(campaignId);
  return renderContextPrompt(ctx);
}

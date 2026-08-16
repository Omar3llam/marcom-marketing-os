// ============================================================
// MARCOM / Lumi — Agent Context Builder (Phase 4)
// ------------------------------------------------------------
// Single source of truth for the per-campaign context blob that
// every agent (Claude, ChatGPT, future Gemini) injects into its
// system prompt. Keeps the wording identical across providers
// so A/B tests measure the *model*, not the prompt.
//
// Contract:
//   - Always include CampaignState.stage (TESTING|SCALING|...)
//
// ── R7: WHAT THIS MODULE NO LONGER CLAIMS ──────────────────────────────────
// It used to carry "the LAST 3 DecisionMemory entries", and a careful
// three-state contract for them: [] meant "we looked and this campaign has no
// history" (a fact about the campaign), null meant "we could not look at all"
// (a fact about Lumi). The distinction was right, and the header argued for it
// at length.
//
// The read underneath it was invalid the whole time. It projected columns —
// campaignId, decisionRationale, deltaRoas, isSustainable — that the
// DecisionMemory table does not have, so it could only reject, and the null
// branch was the only branch that ever ran. Every campaign context ever built
// said "(decision memory unavailable)".
//
// R7 removed the read rather than repairing it: the canonical record of what
// Lumi decided is the Decision table, and this module cannot reach it — it keys
// on CampaignState.campaignId (a plain String) while Decision.entityId is a
// @db.Uuid from the entity graph. Wiring that identity together is a new
// capability, not a consolidation, so the section is gone until someone asks
// for it deliberately.
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
 * R7 — the decision-memory half of this context is GONE, not repointed.
 *
 * It read DecisionMemory with a Shape-B projection (`campaignId`,
 * `decisionRationale`, `deltaRoas`, `isSustainable`, …) against a table that has
 * none of those columns, so the query could only ever reject. The `.catch`
 * below it turned that into null, and the renderer faithfully printed
 * "(decision memory unavailable)" — on every call, for every campaign, since
 * the divergence. The honest-null machinery worked perfectly; there was simply
 * never anything behind it.
 *
 * Not repointed to the canonical spine, deliberately: this function keys on
 * CampaignState.campaignId, a plain legacy String, and Decision.entityId is a
 * @db.Uuid from the entity graph — the same identifier mismatch that forced the
 * orchestrator's read to stay workspace-scoped. Giving this prompt real
 * decision history is a new capability, and R7 does not add capabilities.
 */
export async function buildCampaignContext(campaignId) {
  if (!campaignId) return null;

  const state = await prisma.campaignState.findUnique({
    where: { campaignId },
    select: {
      stage: true, healthScore: true, lastAnalysis: true, workspaceId: true,
    },
  });

  if (!state) return null;
  return { state };
}

/**
 * Render the structured context into a system-prompt fragment.
 * Designed to slot in *after* the role prompt and *before* the
 * task instruction.
 */
export function renderContextPrompt(ctx) {
  if (!ctx) return '';
  const { state } = ctx;

  // R7 — the "Recent decisions" section is gone with the read behind it. It
  // rendered one of three lines, and in practice always the same one:
  // "(decision memory unavailable)". A prompt line that says the same thing on
  // every call for every campaign is not context; it is a constant, and the
  // model was paying attention to it.
  return [
    '── CAMPAIGN CONTEXT ──────────────────────────',
    `Stage:        ${state.stage}`,
    `Health score: ${state.healthScore?.toFixed(2) ?? 'n/a'}`,
    `Last sweep:   ${state.lastAnalysis?.toISOString() ?? 'n/a'}`,
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

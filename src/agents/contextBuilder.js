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
// ============================================================
import { prisma } from '../lib/prisma.js';

/**
 * Build a structured context object for a campaign.
 * Returns null if no CampaignState row exists (caller decides
 * whether to fall back to a generic prompt).
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
      orderBy: { recordedAt: 'desc' },
      take:    3,                                  // hard cap per spec
      select: {
        actionType: true, decisionRationale: true, resultStatus: true,
        deltaCtr: true, deltaRoas: true,
        impactDurationHrs: true, isSustainable: true, recordedAt: true,
      },
    }),
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

  const memLines = recent.length === 0
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

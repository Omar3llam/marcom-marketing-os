// ============================================================
// MARCOM / Lumi — Help content library
// ------------------------------------------------------------
// Single source of truth for every HelpTip. Two shapes:
//   • string        → a hover tooltip (variant="tooltip"), ≤ ~140 chars.
//   • { title, description, link? } → a click popover (variant="popover").
//
// HONESTY: every "how it's computed" line matches the real engine logic
// (AccountHealthService, verdict engine, agentic loop, Proof engine) so the
// explanation can't drift from the number it explains. Thresholds that are
// backend-derived (e.g. the Proof reliability minimum) are described, NOT
// hardcoded, so the copy stays true if the backend tunes them.
// ============================================================

export const HELP = {
  // ── Simple tooltips (hover, string) ─────────────────────────
  TOTAL_SPEND:  'Total spend across all connected channels in this period.',
  CTR:          'Click-through rate — the share of impressions that led to a click.',
  FREQUENCY:    'Average times each person saw your ad. Above ~3.5 signals audience fatigue.',
  ROAS:         'Return on ad spend — revenue generated per unit of spend.',
  CONVERSIONS:  'Number of desired actions completed (purchases, leads, sign-ups).',
  OBJECTIVE:    'The campaign goal set on the platform (e.g. sales, leads, awareness).',
  VERDICT_COL:  'Lumi’s recommendation for each campaign: SCALE, HOLD, WATCH, REALLOCATE, REFRESH, or KILL.',
  KEY_SIGNAL:   'The one metric behind this verdict: ROAS when revenue is measured, Frequency when the audience is saturated, otherwise CTR.',

  // Per-verdict one-liners (match the verdict engine vocabulary).
  SCALE_VERDICT:      'Strong performance — increase budget or expand the audience.',
  HOLD_VERDICT:       'Stable but not improving — keep running and monitor.',
  WATCH_VERDICT:      'Early signs of decline — monitor closely and be ready to act.',
  REALLOCATE_VERDICT: 'Budget is better spent elsewhere — move spend to stronger campaigns.',
  REFRESH_VERDICT:    'Creative fatigue — the audience has seen this ad too often. Refresh the creative.',
  KILL_VERDICT:       'Underperforming — pause or stop this campaign to stop the bleed.',

  // ── Complex popovers (click, { title, description }) ────────
  WASTED_SPEND: {
    title: 'Budget at Risk',
    description: 'Spend on campaigns Lumi verdicts as KILL or REFRESH — money that isn’t working and could be reallocated. Shown as an amount and a share of total spend.',
  },
  PUBLISHING_WORKFLOW: {
    title: 'Publishing workflow',
    description: 'Creative moves from pending approval to approved. Once a strategist approves an artifact, use its copy and brief to create the ad in Meta Ads Manager, then record the Meta IDs to link performance back — Lumi does not publish the ad for you. Direct API publishing is on the roadmap.',
  },
  FATIGUE_FORECAST: {
    title: 'Fatigue Forecast',
    description: 'Projects when each campaign’s audience will saturate — frequency reaching ~3.5 — by fitting how fast frequency is rising across recent daily syncs. Re-scored on every sync; a campaign with flat or falling frequency reads as stable, and one already past the ceiling as saturated now. Where Meta reports it, reach (unique people reached) is shown, and “% of ceiling” is how far current frequency sits toward the 3.5× saturation line.',
  },
  ACCOUNT_HEALTH: {
    title: 'Account Health (0–100)',
    description: 'A spend-weighted roll-up of every campaign’s verdict, adjusted for CTR and audience frequency. Below 40 = needs attention; 80+ = a healthy portfolio. "—" until a channel has synced.',
  },
  IMPACT_SCORE: {
    title: 'Impact (1–10)',
    description: 'How much acting on this campaign matters right now — verdict severity weighted by its share of account spend, nudged up when ROAS is below 1. A big KILL scores highest.',
  },
  BLENDED_CPA: {
    title: 'Blended CPA',
    description: 'Cost per acquisition from your actual conversion data across channels — not the platform-reported CPA in Meta/Google Ads Manager, which usually overcounts.',
  },
  BLENDED_TRUTH: {
    title: 'Blended Truth',
    description: 'The gap between what Meta/Google claim and what actually happened in your business. Platforms often overcount conversions; Blended Truth reconciles their numbers against real revenue.',
  },
  BLENDED_ROAS: {
    title: 'Blended revenue efficiency',
    description: 'Selected Blended Truth revenue divided by compatible paid-media spend. This differs from platform ROAS and from MER, which requires authoritative total-business revenue.',
  },
  LOOP_STALLED: {
    title: 'The decision loop',
    description: 'Lumi runs six stages: Plan → Allocate → Execute → Test → Measure → Learn. "Stalled" means no actions have been confirmed recently. Run a manual sweep to re-scan campaigns and propose fresh moves — a sweep never executes on its own.',
  },
  PROOF_OF_LEARNING: {
    title: 'Proof of Learning',
    description: 'Lumi tracks whether its past verdicts were right. Once enough decisions are confirmed and scored, it reports how calibrated it is on your account. Until then it’s still learning — no calibration number is shown.',
  },
  CALIBRATION: {
    title: 'Calibration error (ECE)',
    description: 'How well Lumi’s confidence matches reality. Well-calibrated means when it says "90% confident", it’s right about 90% of the time. Lower ECE = better calibrated.',
  },
  STILL_LEARNING: {
    title: 'Still learning',
    description: 'Calibration is reported only after enough confirmed, scored decisions accumulate. Each verdict you confirm and record an outcome for teaches Lumi whether its prediction held.',
  },
  INCREMENTALITY: {
    title: 'Incrementality',
    description: 'Holdout experiments that measure the true causal impact of your ads — how much revenue they actually caused, not just correlated with. The only causal signal in the product.',
  },
  MDE: {
    title: 'Minimum Detectable Effect',
    description: 'The smallest lift a test can reliably detect. A 10% MDE means the test can only prove your ads caused at least a 10% improvement. Lower MDE = more sensitive, but needs more traffic.',
  },
  HOLDOUT: {
    title: 'Holdout group',
    description: 'A control group deliberately not shown your ads during a test. Comparing it to the exposed group reveals the real incremental impact of advertising.',
  },
};

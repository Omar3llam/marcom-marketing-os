// ============================================================
// Verdict Engine — stable verdict vocabulary
// ============================================================
// The canonical marketing verdict taxonomy. Mirrors the Prisma
// `Verdict` enum. KILL/HOLD/SCALE/WATCH are the originals; Phase 2
// adds REALLOCATE (move budget) and REFRESH (swap creative) as
// first-class verdicts with their own execution paths.
//
// No dynamic labels — every verdict must appear here first.
// ============================================================
import { REC_TYPE } from '../recommendation-engine/index.js';

export const VERDICT = Object.freeze({
  KILL:       'KILL',
  HOLD:       'HOLD',
  SCALE:      'SCALE',
  WATCH:      'WATCH',
  REALLOCATE: 'REALLOCATE',
  REFRESH:    'REFRESH',
});

// Verdict → the recommendation types its execution path is built from.
// KILL/HOLD/WATCH have no generative recommendations (KILL is a direct
// Meta pause; HOLD/WATCH are monitor-only).
export const VERDICT_TO_REC_TYPES = Object.freeze({
  [VERDICT.KILL]:       [],
  [VERDICT.HOLD]:       [REC_TYPE.HOLD_STEADY],
  [VERDICT.WATCH]:      [REC_TYPE.HOLD_STEADY],
  [VERDICT.SCALE]:      [REC_TYPE.DUPLICATE_WINNER],
  [VERDICT.REALLOCATE]: [REC_TYPE.REALLOCATE_BUDGET],
  [VERDICT.REFRESH]:    [REC_TYPE.REFRESH_CREATIVE],
});

/**
 * Map a verdict + entity level to the Meta ActionType used by the
 * confirm→execute governance (src/routes/execution/meta.js). Returns
 * null for verdicts with no direct Meta action (HOLD / WATCH).
 *
 * @param {string} verdict
 * @param {('ACCOUNT'|'CAMPAIGN'|'ADSET'|'AD'|'CREATIVE')} level
 * @returns {string|null} ActionType enum value, or null
 */
export function verdictToActionType(verdict, level) {
  const isCampaign = level === 'CAMPAIGN' || level === 'ACCOUNT';
  switch (verdict) {
    case VERDICT.KILL:       return isCampaign ? 'PAUSE_CAMPAIGN' : 'PAUSE_ADSET';
    case VERDICT.SCALE:      return isCampaign ? 'SCALE_CAMPAIGN' : 'INCREASE_BUDGET';
    case VERDICT.REALLOCATE: return 'REALLOCATE_BUDGET';
    case VERDICT.REFRESH:    return 'REFRESH_CREATIVE';
    case VERDICT.HOLD:
    case VERDICT.WATCH:
    default:                 return null;
  }
}

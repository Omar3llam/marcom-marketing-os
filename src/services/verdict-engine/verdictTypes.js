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

// Why a verdict was reached, as a stable machine-readable key. `rationale` is
// prose for a human; this is what the learning query groups on, so it must not
// be a sentence. Data-quality causes are first-class here: "we did not judge
// this yet, and here is exactly what is missing" is a real answer, and the one
// the engine used to be unable to give — it scored a 12-impression campaign with
// the same machinery as a 12-million-impression one.
export const ROOT_CAUSE = Object.freeze({
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA', // below the minimum sample to read a rate
  TOO_EARLY:         'TOO_EARLY',         // real sample, but not enough days to have settled
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

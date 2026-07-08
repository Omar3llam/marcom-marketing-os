// ============================================================
// helpContent — the HELP library is well-formed + honest
// ------------------------------------------------------------
// Every entry is either a non-empty tooltip string or a well-formed popover
// object. Locks the honesty correction: Proof copy must NOT hardcode a specific
// "30 decisions" threshold (the reliability minimum is backend-derived).
// ============================================================
import { describe, it, expect } from 'vitest';
import { HELP } from './helpContent.js';

describe('HELP library', () => {
  it('every entry is a non-empty string OR a { title, description } popover', () => {
    for (const [key, val] of Object.entries(HELP)) {
      if (typeof val === 'string') {
        expect(val.trim().length, key).toBeGreaterThan(0);
      } else {
        expect(typeof val, key).toBe('object');
        expect(val.title?.trim().length, `${key}.title`).toBeGreaterThan(0);
        expect(val.description?.trim().length, `${key}.description`).toBeGreaterThan(0);
      }
    }
  });

  it('defines the key metrics + concepts the pages reference', () => {
    for (const k of ['TOTAL_SPEND', 'CTR', 'FREQUENCY', 'ROAS', 'VERDICT_COL',
      'WASTED_SPEND', 'ACCOUNT_HEALTH', 'IMPACT_SCORE', 'BLENDED_CPA', 'BLENDED_TRUTH',
      'BLENDED_ROAS', 'LOOP_STALLED', 'PROOF_OF_LEARNING', 'CALIBRATION', 'INCREMENTALITY',
      'MDE', 'HOLDOUT']) {
      expect(HELP[k], k).toBeDefined();
    }
  });

  it('does not hardcode a "30 decisions" threshold in Proof copy (backend-derived)', () => {
    expect(HELP.PROOF_OF_LEARNING.description).not.toMatch(/\b30\b/);
    expect(HELP.STILL_LEARNING.description).not.toMatch(/\b30\b/);
  });

  it('Wasted Spend copy matches the engine definition (KILL + REFRESH)', () => {
    expect(HELP.WASTED_SPEND.description).toMatch(/KILL/);
    expect(HELP.WASTED_SPEND.description).toMatch(/REFRESH/);
  });
});

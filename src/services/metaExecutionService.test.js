// ============================================================
// metaExecutionService — governance for Phase 2 action types
// ============================================================
// Confirms the REALLOCATE_BUDGET / REFRESH_CREATIVE verdict
// execution paths validate through the confirm→execute governance
// and reject mismatched target types.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { validateActionTarget } from './metaExecutionService.js';

describe('validateActionTarget — Phase 2 verdict action types', () => {
  it('REALLOCATE_BUDGET targets campaign and adset', () => {
    expect(validateActionTarget('REALLOCATE_BUDGET', 'campaign')).toBe(true);
    expect(validateActionTarget('REALLOCATE_BUDGET', 'adset')).toBe(true);
  });

  it('REALLOCATE_BUDGET rejects an ad target', () => {
    expect(validateActionTarget('REALLOCATE_BUDGET', 'ad')).toBe(false);
  });

  it('REFRESH_CREATIVE targets adset and ad', () => {
    expect(validateActionTarget('REFRESH_CREATIVE', 'adset')).toBe(true);
    expect(validateActionTarget('REFRESH_CREATIVE', 'ad')).toBe(true);
  });

  it('REFRESH_CREATIVE rejects a campaign target', () => {
    expect(validateActionTarget('REFRESH_CREATIVE', 'campaign')).toBe(false);
  });

  it('still rejects unknown action types', () => {
    expect(validateActionTarget('NUKE_EVERYTHING', 'campaign')).toBe(false);
  });
});

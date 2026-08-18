// ============================================================
// devOverrides — R11 (I62) negative controls
// ------------------------------------------------------------
// Three env vars short-circuit a real authorization decision. Each was read
// unconditionally, so one stray value in a production environment silently
// rewrote the entitlement, the role, or the paywall for every request.
// ============================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { devOverride, _resetOverrideWarnings } from './devOverrides.js';
import { logger } from '../utils/logger.js';

const ENV = { ...process.env };
beforeEach(() => { vi.clearAllMocks(); _resetOverrideWarnings(); });
afterEach(() => { process.env = { ...ENV }; });

describe('devOverride', () => {
  it('returns the value outside production', () => {
    process.env.NODE_ENV = 'development';
    process.env.PLAN_OVERRIDE = 'PRO';
    expect(devOverride('PLAN_OVERRIDE')).toBe('PRO');
  });

  it('returns the value in test', () => {
    process.env.NODE_ENV = 'test';
    process.env.PLAN_OVERRIDE = 'GROWTH';
    expect(devOverride('PLAN_OVERRIDE')).toBe('GROWTH');
  });

  it('returns null when unset', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.PLAN_OVERRIDE;
    expect(devOverride('PLAN_OVERRIDE')).toBeNull();
  });

  // ── the control ────────────────────────────────────────────
  it('returns null in production for every override', () => {
    process.env.NODE_ENV = 'production';
    process.env.PLAN_OVERRIDE = 'PRO';
    process.env.COLLAB_ROLE_OVERRIDE = 'STRATEGIST';
    process.env.MEASUREMENT_TIER_OVERRIDE = 'FULL';

    expect(devOverride('PLAN_OVERRIDE')).toBeNull();
    expect(devOverride('COLLAB_ROLE_OVERRIDE')).toBeNull();
    expect(devOverride('MEASUREMENT_TIER_OVERRIDE')).toBeNull();
  });

  it('reports the misconfiguration once per variable, not once per request', () => {
    process.env.NODE_ENV = 'production';
    process.env.PLAN_OVERRIDE = 'PRO';

    devOverride('PLAN_OVERRIDE');
    devOverride('PLAN_OVERRIDE');
    devOverride('PLAN_OVERRIDE');

    // A standing misconfiguration logged per request buries itself.
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toMatchObject({ override: 'PLAN_OVERRIDE' });
  });
});

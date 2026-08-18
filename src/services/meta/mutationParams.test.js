// ============================================================
// R11-D — Meta mutation parameters  (I67)
// ------------------------------------------------------------
// `targetId` was validated as "a non-empty string" and then interpolated into
// the Graph API request PATH. A string may contain `/`, `?` and `&`, so the
// caller controlled the path and the query of an authenticated POST made with
// the workspace's own Meta token. OPTIMIZE_CAMPAIGN went further and forwarded
// the caller's entire options object as Graph API fields.
//
// Every case below fails if either check is loosened.
// ============================================================
import { describe, expect, it } from 'vitest';
import { isValidTargetId, validateMutationParams, validateOptions, ALLOWED_OPTION_KEYS } from './mutationParams.js';
import { buildRequest } from '../metaExecutionService.js';

const ok = (extra = {}) => ({
  actionType: 'PAUSE_CAMPAIGN',
  targetId:   '120200000000001',
  targetType: 'campaign',
  ...extra,
});

describe('isValidTargetId (I67)', () => {
  it('accepts a bare numeric object id', () => {
    expect(isValidTargetId('120200000000001')).toBe(true);
  });

  it('accepts an act_-prefixed account id', () => {
    expect(isValidTargetId('act_123456')).toBe(true);
  });

  // ── NC-H3 · the control ────────────────────────────────────
  it('REFUSES a value that would break out of the path', () => {
    expect(isValidTargetId('123/456')).toBe(false);
    expect(isValidTargetId('123?fields=all')).toBe(false);
    expect(isValidTargetId('123&status=ACTIVE')).toBe(false);
    expect(isValidTargetId('123#frag')).toBe(false);
    expect(isValidTargetId('../me/adaccounts')).toBe(false);
  });

  it('REFUSES a value that merely starts with digits', () => {
    // Unanchored matching would let `123&access_token=…` through.
    expect(isValidTargetId('123abc')).toBe(false);
    expect(isValidTargetId(' 123')).toBe(false);
    expect(isValidTargetId('123 ')).toBe(false);
  });

  it('REFUSES empty, non-string and absurdly long values', () => {
    expect(isValidTargetId('')).toBe(false);
    expect(isValidTargetId(null)).toBe(false);
    expect(isValidTargetId(12345)).toBe(false);
    expect(isValidTargetId('1'.repeat(64))).toBe(false);
  });
});

describe('validateMutationParams (I67)', () => {
  it('accepts a well-formed pause', () => {
    expect(validateMutationParams(ok())).toBeNull();
  });

  it('rejects an unknown action type', () => {
    expect(validateMutationParams(ok({ actionType: 'DELETE_ACCOUNT' }))).toMatch(/Invalid action type/);
  });

  it('rejects an action/target mismatch', () => {
    expect(validateMutationParams(ok({ actionType: 'PAUSE_ADSET' }))).toMatch(/Invalid target type/);
  });

  it('rejects a malformed targetId without echoing it back', () => {
    const msg = validateMutationParams(ok({ targetId: '123&status=ACTIVE' }));
    expect(msg).toMatch(/Meta object id/);
    // The value is attacker-controlled and ends up in logs and error surfaces.
    expect(msg).not.toContain('status=ACTIVE');
  });
});

describe('OPTIMIZE_CAMPAIGN takes an allowlist, not a pass-through (I67)', () => {
  it('accepts the documented fields', () => {
    expect(validateOptions('OPTIMIZE_CAMPAIGN', { bid_strategy: 'COST_CAP', daily_budget: 5000 })).toBeNull();
  });

  // ── NC-H4 · the control ────────────────────────────────────
  it('REFUSES a field outside the allowlist', () => {
    expect(validateOptions('OPTIMIZE_CAMPAIGN', { name: 'renamed by attacker' }))
      .toMatch(/not permitted/);
    expect(validateOptions('OPTIMIZE_CAMPAIGN', { daily_budget: 5000, adset_id: '999' }))
      .toMatch(/not permitted/);
  });

  it('REFUSES a permitted field with an impermissible value', () => {
    expect(validateOptions('OPTIMIZE_CAMPAIGN', { status: 'DELETED' })).toMatch(/must be one of/);
    expect(validateOptions('OPTIMIZE_CAMPAIGN', { bid_strategy: 'FREE_MONEY' })).toMatch(/must be one of/);
    expect(validateOptions('OPTIMIZE_CAMPAIGN', { daily_budget: -1 })).toMatch(/positive whole number/);
    expect(validateOptions('OPTIMIZE_CAMPAIGN', { daily_budget: 'lots' })).toMatch(/positive whole number/);
  });

  it('REFUSES Graph API fields on actions that take no free-form options', () => {
    expect(validateOptions('PAUSE_CAMPAIGN', { status: 'ACTIVE' })).toMatch(/does not accept/);
    expect(validateOptions('PAUSE_CAMPAIGN', { name: 'x' })).toMatch(/does not accept/);
  });

  it('still allows the endpoint builder\'s own non-Graph inputs', () => {
    // dailyBudget / amount / creativeId are read by buildRequest and are not
    // forwarded as fields, so narrowing must not break them.
    expect(validateOptions('INCREASE_BUDGET', { dailyBudget: 5000 })).toBeNull();
    expect(validateOptions('REFRESH_CREATIVE', { creativeId: '999' })).toBeNull();
  });

  it('rejects a non-object options value', () => {
    expect(validateOptions('OPTIMIZE_CAMPAIGN', 'status=ACTIVE')).toMatch(/must be an object/);
    expect(validateOptions('OPTIMIZE_CAMPAIGN', ['status'])).toMatch(/must be an object/);
  });
});

describe('buildRequest returns a validated path plus params, never one string (I67/I68)', () => {
  it('builds a pause as path + body params', () => {
    expect(buildRequest('PAUSE_CAMPAIGN', '120200000000001')).toEqual({
      path: '/120200000000001',
      params: { status: 'PAUSED' },
    });
  });

  it('builds a budget change from dailyBudget', () => {
    expect(buildRequest('INCREASE_BUDGET', '120200000000001', { dailyBudget: 5000.4 })).toEqual({
      path: '/120200000000001',
      params: { daily_budget: 5000 },
    });
  });

  it('re-checks the targetId itself rather than trusting the route', () => {
    // This is the last point before a real credential is attached, and the
    // worker is a separate entry path into it.
    expect(() => buildRequest('PAUSE_CAMPAIGN', '123?fields=all')).toThrow(/Meta object id/);
  });

  it('REFUSES an OPTIMIZE_CAMPAIGN field outside the allowlist', () => {
    expect(() => buildRequest('OPTIMIZE_CAMPAIGN', '120200000000001', { name: 'x' })).toThrow(/not permitted/);
  });

  it('REFUSES an OPTIMIZE_CAMPAIGN with nothing to optimise', () => {
    expect(() => buildRequest('OPTIMIZE_CAMPAIGN', '120200000000001', {})).toThrow(/requires at least one/);
  });

  it('forwards only allowlisted OPTIMIZE fields, in the allowlist\'s own terms', () => {
    const { params } = buildRequest('OPTIMIZE_CAMPAIGN', '120200000000001', { status: 'PAUSED', spend_cap: 100000 });
    expect(Object.keys(params).every((k) => ALLOWED_OPTION_KEYS.OPTIMIZE_CAMPAIGN.includes(k))).toBe(true);
    expect(params).toEqual({ status: 'PAUSED', spend_cap: 100000 });
  });

  it('REFUSES a creativeId that is not a Meta object id', () => {
    expect(() => buildRequest('REFRESH_CREATIVE', '120200000000001', { creativeId: '1&x=2' })).toThrow(/Meta object id/);
  });
});

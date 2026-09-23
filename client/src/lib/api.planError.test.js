// ============================================================
// api — 403 PLAN_REQUIRED mapping (the paywall seam)
// ------------------------------------------------------------
// A plan-paywall 403 (requirePlan) must be distinguishable from a role/auth 403
// so the UI can offer an upgrade path — without disturbing the existing role-403
// handling. mapTransportError is pure, so we drive it directly with fake axios
// error shapes (no network, no firebase).
// ============================================================
import { describe, it, expect, vi } from 'vitest';

// firebase is imported transitively by api.js; stub it so the module loads.
vi.mock('../firebase.js', () => ({ auth: { currentUser: null } }));

import { mapTransportError } from './api.js';

const err403 = (data) => ({ response: { status: 403, data }, config: { url: '/api/lumi/blended' } });

describe('mapTransportError — 403 PLAN_REQUIRED', () => {
  it('tags a plan paywall 403 with code PLAN_REQUIRED + the required/current tiers', () => {
    const mapped = mapTransportError(err403({
      error: 'PLAN_REQUIRED', required: 'GROWTH', current: 'FREE',
      message: 'This feature requires the GROWTH plan.',
    }));
    expect(mapped.code).toBe('PLAN_REQUIRED');
    expect(mapped.message).toMatch(/GROWTH plan/i);
    expect(mapped.context).toMatchObject({ requiredPlan: 'GROWTH', currentPlan: 'FREE' });
  });

  it('leaves a role/permission 403 on the existing generic path (unchanged)', () => {
    const mapped = mapTransportError(err403({ error: 'RoleForbidden', role: 'CLIENT' }));
    expect(mapped.code).toBe('AUTH_ACCESS_DENIED');
    expect(mapped.code).not.toBe('PLAN_REQUIRED');
  });
});

describe('mapTransportError — monetary 409', () => {
  it.each(['AllocationMonetaryUnavailable', 'PlanMonetaryUnavailable'])('preserves %s reason and status', (error) => {
    const mapped = mapTransportError({
      response: { status: 409, data: { error, monetaryStatus: 'MONETARY_UNAVAILABLE_UNTRUSTED', reason: 'BUDGET_CURRENCY_MISMATCH' } },
      config: { url: '/api/lumi/plans' },
    });
    expect(mapped.httpStatus).toBe(409);
    expect(mapped.code).toBe(error);
    expect(mapped.context).toMatchObject({ reason: 'BUDGET_CURRENCY_MISMATCH', monetaryStatus: 'MONETARY_UNAVAILABLE_UNTRUSTED' });
  });

  it('leaves unrelated 409 mapping unchanged', () => {
    const mapped = mapTransportError({ response: { status: 409, data: { error: 'ApprovalRequired' } }, config: { url: '/api/lumi/plans/1/promote' } });
    expect(mapped.code).toBe('UNKNOWN_ERROR');
  });
});

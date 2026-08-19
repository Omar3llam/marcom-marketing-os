// ============================================================
// R13-D / B3 — what Lumi will and will not offer to run
// ============================================================
// The single rule this module exists for: never offer Execute on something that
// would become a fake success. Most of this file is therefore about REFUSALS,
// and about refusing for the RIGHT reason — "this asks for nothing" and "we
// would raise the budget but do not know to what" are different sentences on
// screen and different fixes for the operator.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  executabilityFor, NOT_EXECUTABLE, SELF_CONTAINED_ACTIONS, EXECUTABLE_CHANNELS,
} from './decisionExecutability.js';
import { VERDICT } from '../verdict-engine/verdictTypes.js';
import { ALLOWED_ACTIONS } from '../meta/mutationParams.js';

const base = (over = {}) => ({
  verdict: VERDICT.KILL, entityLevel: 'CAMPAIGN', channel: 'META',
  externalId: '23851234567', decisionId: 'd-1', ...over,
});

describe('the executable case', () => {
  it('a KILL on a synced Meta campaign becomes PAUSE_CAMPAIGN', () => {
    expect(executabilityFor(base())).toEqual({
      supported: true, actionType: 'PAUSE_CAMPAIGN',
      targetId: '23851234567', targetType: 'campaign', reason: null,
    });
  });

  it('targets the PLATFORM id, never our entityId', () => {
    // The two are not interchangeable and the route validates the difference:
    // a uuid here would be refused as a malformed Meta object id, after the
    // operator had already been shown a working button.
    const r = executabilityFor(base({ externalId: '99001122' }));
    expect(r.targetId).toBe('99001122');
    expect(r.targetId).not.toMatch(/-/);
  });

  it('a uuid in externalId is refused as NO_PLATFORM_ID, not passed through', () => {
    const r = executabilityFor(base({ externalId: '00000000-0000-4000-8000-000000000001' }));
    expect(r.supported).toBe(false);
    expect(r.reason).toBe(NOT_EXECUTABLE.NO_PLATFORM_ID);
  });
});

describe('refusals, each for its own reason', () => {
  it('no stored decision → NO_DECISION, checked before anything else', () => {
    // First, because it is the one refusal about US: everything else could be
    // perfectly executable and we would still produce a mutation the Proof
    // Engine can never attribute.
    const r = executabilityFor(base({ decisionId: null }));
    expect(r.supported).toBe(false);
    expect(r.reason).toBe(NOT_EXECUTABLE.NO_DECISION);
    expect(r.actionType).toBeNull();
  });

  it.each([VERDICT.HOLD, VERDICT.WATCH])('%s asks for no intervention → NO_ACTION_FOR_VERDICT', (verdict) => {
    const r = executabilityFor(base({ verdict }));
    expect(r.supported).toBe(false);
    expect(r.reason).toBe(NOT_EXECUTABLE.NO_ACTION_FOR_VERDICT);
  });

  it.each(['GOOGLE', 'TIKTOK', 'SNAP', 'LINKEDIN', null])('%s has no mutation → UNSUPPORTED_CHANNEL', (channel) => {
    // Discovery proved there is exactly one provider mutation in the codebase.
    // A Google KILL must not render a button that queues a request no worker
    // can carry out.
    const r = executabilityFor(base({ channel }));
    expect(r.supported).toBe(false);
    expect(r.reason).toBe(NOT_EXECUTABLE.UNSUPPORTED_CHANNEL);
  });

  it('a campaign with no platform id → NO_PLATFORM_ID', () => {
    const r = executabilityFor(base({ externalId: null }));
    expect(r.supported).toBe(false);
    expect(r.reason).toBe(NOT_EXECUTABLE.NO_PLATFORM_ID);
  });
});

describe('actions that are real but not yet runnable', () => {
  // metaExecutionService.buildRequest THROWS for these without options Lumi
  // does not hold. Offering them would queue a request that fails in the worker
  // with a 400 the operator never asked for — a click that looks like an action
  // and produces an error.
  it.each([
    [VERDICT.SCALE,      'SCALE_CAMPAIGN'],
    [VERDICT.REALLOCATE, 'REALLOCATE_BUDGET'],
  ])('%s → NEEDS_OPERATOR_INPUT, and still names the action', (verdict, actionType) => {
    const r = executabilityFor(base({ verdict }));
    expect(r.supported).toBe(false);
    expect(r.reason).toBe(NOT_EXECUTABLE.NEEDS_OPERATOR_INPUT);
    // The action IS named, so the surface can say what it would have done
    // rather than going silent about a real recommendation.
    expect(r.actionType).toBe(actionType);
    expect(r.targetId).toBe('23851234567');
  });

  it('REFRESH at CAMPAIGN level is refused earlier — the action does not apply there', () => {
    // ALLOWED_ACTIONS.REFRESH_CREATIVE is ['adset', 'ad']: a creative hangs off
    // an ad set, not a campaign. So the campaign-level decision surface refuses
    // this on the allow-list, BEFORE the missing-creativeId question is reached.
    // Two different refusals, and the earlier one is the truer answer.
    const r = executabilityFor(base({ verdict: VERDICT.REFRESH, entityLevel: 'CAMPAIGN' }));
    expect(r.supported).toBe(false);
    expect(r.reason).toBe(NOT_EXECUTABLE.ACTION_NOT_ALLOWED);
  });

  it('REFRESH at ADSET level reaches the operator-input refusal', () => {
    const r = executabilityFor(base({ verdict: VERDICT.REFRESH, entityLevel: 'ADSET' }));
    expect(r.supported).toBe(false);
    expect(r.reason).toBe(NOT_EXECUTABLE.NEEDS_OPERATOR_INPUT);
    expect(r.actionType).toBe('REFRESH_CREATIVE');
  });

  it('the self-contained list is exactly the actions buildRequest needs no options for', () => {
    // The precondition behind every NEEDS_OPERATOR_INPUT above. If a future
    // action starts deriving its own parameters, this is where it gets added —
    // deliberately, rather than by a verdict quietly becoming executable.
    expect(SELF_CONTAINED_ACTIONS).toEqual(['PAUSE_CAMPAIGN', 'RESUME_CAMPAIGN', 'PAUSE_ADSET', 'RESUME_ADSET']);
    for (const a of SELF_CONTAINED_ACTIONS) {
      expect(ALLOWED_ACTIONS[a], `${a} must be a real mutation`).toBeDefined();
    }
  });

  it('META is the only executable channel — an allow-list, not a deny-list', () => {
    expect(EXECUTABLE_CHANNELS).toEqual(['META']);
  });
});

describe('the answer always agrees with the route that will receive it', () => {
  it('a supported action/target pair is one the mutation allow-list permits', () => {
    // The route re-validates with ALLOWED_ACTIONS. If this module ever offered
    // a pair the route rejects, the operator would get a 400 from a button we
    // told them was ready.
    for (const verdict of Object.values(VERDICT)) {
      for (const entityLevel of ['CAMPAIGN', 'ADSET']) {
        const r = executabilityFor(base({ verdict, entityLevel }));
        if (!r.supported) continue;
        expect(ALLOWED_ACTIONS[r.actionType]).toContain(r.targetType);
      }
    }
  });

  it('every refusal carries a reason and no half-answer', () => {
    const cases = [
      base({ decisionId: null }), base({ verdict: VERDICT.HOLD }),
      base({ channel: 'GOOGLE' }), base({ externalId: null }), base({ verdict: VERDICT.SCALE }),
    ];
    for (const c of cases) {
      const r = executabilityFor(c);
      expect(r.supported).toBe(false);
      expect(typeof r.reason).toBe('string');
      expect(Object.values(NOT_EXECUTABLE)).toContain(r.reason);
    }
  });

  it('an empty call refuses rather than throwing', () => {
    const r = executabilityFor();
    expect(r.supported).toBe(false);
    expect(r.reason).toBe(NOT_EXECUTABLE.NO_DECISION);
  });
});

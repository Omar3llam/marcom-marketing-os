import { describe, it, expect } from 'vitest';
import {
  WORKSPACE_ROLE, visibleStates, canSeeState, canApprove, canExecute,
  canAuthorNarrative, canHandoffTo, normalizeRole,
} from './roleScope.js';

describe('roleScope', () => {
  it('CLIENT is read-only narrative — sees REPORT only', () => {
    expect(visibleStates(WORKSPACE_ROLE.CLIENT)).toEqual(['REPORT']);
    expect(canSeeState(WORKSPACE_ROLE.CLIENT, 'REPORT')).toBe(true);
    expect(canSeeState(WORKSPACE_ROLE.CLIENT, 'MEASURE')).toBe(false);
    expect(canExecute(WORKSPACE_ROLE.CLIENT)).toBe(false);
    expect(canApprove(WORKSPACE_ROLE.CLIENT)).toBe(false);
  });

  it('BUYER lacks PLAN/MEASURE but can execute; cannot approve', () => {
    expect(canSeeState(WORKSPACE_ROLE.BUYER, 'PLAN')).toBe(false);
    expect(canSeeState(WORKSPACE_ROLE.BUYER, 'MEASURE')).toBe(false);
    expect(canSeeState(WORKSPACE_ROLE.BUYER, 'REPORT')).toBe(true);
    expect(canExecute(WORKSPACE_ROLE.BUYER)).toBe(true);
    expect(canApprove(WORKSPACE_ROLE.BUYER)).toBe(false);
  });

  it('STRATEGIST sees everything, approves, authors narratives', () => {
    expect(canSeeState(WORKSPACE_ROLE.STRATEGIST, 'PLAN')).toBe(true);
    expect(canSeeState(WORKSPACE_ROLE.STRATEGIST, 'MEASURE')).toBe(true);
    expect(canApprove(WORKSPACE_ROLE.STRATEGIST)).toBe(true);
    expect(canAuthorNarrative(WORKSPACE_ROLE.STRATEGIST)).toBe(true);
  });

  it.each([null, undefined, 'GARBAGE'])('unresolved role %s has no scope or authority', (role) => {
    expect(normalizeRole(role)).toBeNull();
    expect(visibleStates(role)).toEqual([]);
    expect(canApprove(role)).toBe(false);
    expect(canExecute(role)).toBe(false);
    expect(canAuthorNarrative(role)).toBe(false);
  });

  it('handoff is legal strategist↔buyer, never to/from client', () => {
    expect(canHandoffTo(WORKSPACE_ROLE.STRATEGIST, WORKSPACE_ROLE.BUYER)).toBe(true);
    expect(canHandoffTo(WORKSPACE_ROLE.BUYER, WORKSPACE_ROLE.STRATEGIST)).toBe(true);
    expect(canHandoffTo(WORKSPACE_ROLE.STRATEGIST, WORKSPACE_ROLE.CLIENT)).toBe(false);
    expect(canHandoffTo(WORKSPACE_ROLE.CLIENT, WORKSPACE_ROLE.BUYER)).toBe(false);
  });

  it('handoff rejects unknown roles instead of defaulting them to STRATEGIST', () => {
    expect(canHandoffTo('UNKNOWN', WORKSPACE_ROLE.BUYER)).toBe(false);
    expect(canHandoffTo(null, WORKSPACE_ROLE.BUYER)).toBe(false);
    expect(canHandoffTo(WORKSPACE_ROLE.BUYER, 'UNKNOWN')).toBe(false);
  });
});

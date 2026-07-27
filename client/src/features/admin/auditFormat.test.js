// ============================================================
// auditFormat — the audit row's reading rules
// ------------------------------------------------------------
// An audit log that guesses is worse than one that admits it doesn't know, so
// every branch here is really the same assertion: when the payload doesn't say
// what changed, the cell says "—".
// ============================================================
import { describe, it, expect } from 'vitest';
import { actionLabel, describeChange, shortId, formatWhen } from './auditFormat.js';

describe('actionLabel', () => {
  it.each([
    ['CHANGE_ROLE', 'Changed role'],
    ['CHANGE_PLAN', 'Changed plan'],
    ['SEED_DEMO', 'Seeded demo workspace'],
    ['DELETE_DEMO', 'Deleted demo workspace'],
  ])('%s reads as "%s"', (type, label) => expect(actionLabel(type)).toBe(label));

  // A type added server-side before the client knows it must still show up.
  it('shows an unknown type raw rather than dropping the row', () => {
    expect(actionLabel('DEACTIVATE_USER')).toBe('DEACTIVATE_USER');
  });

  it('has no label for nothing', () => expect(actionLabel(undefined)).toBe('—'));
});

describe('describeChange — CHANGE_ROLE', () => {
  it('reads as a transition', () => {
    expect(describeChange({ type: 'CHANGE_ROLE', before: { collabRole: 'STRATEGIST' }, after: { collabRole: 'BUYER' } }))
      .toEqual({ text: 'Strategist → Buyer', forced: false });
  });

  // null is not "no role" — roleScope reads it as STRATEGIST.
  it('names a null role as the unset strategist default, never "None"', () => {
    const { text } = describeChange({ type: 'CHANGE_ROLE', before: { collabRole: null }, after: { collabRole: 'CLIENT' } });
    expect(text).toBe('Strategist (unset) → Client');
  });

  it('surfaces a forced downgrade', () => {
    expect(describeChange({
      type: 'CHANGE_ROLE', before: { collabRole: 'STRATEGIST' }, after: { collabRole: 'BUYER', forced: true },
    }).forced).toBe(true);
  });

  it('is not forced when the flag is absent', () => {
    expect(describeChange({ type: 'CHANGE_ROLE', before: {}, after: { collabRole: 'BUYER' } }).forced).toBe(false);
  });
});

describe('describeChange — the other types', () => {
  it('CHANGE_PLAN reads as a plan transition', () => {
    expect(describeChange({ type: 'CHANGE_PLAN', before: { plan: 'FREE' }, after: { plan: 'PRO' } }).text)
      .toBe('FREE → PRO');
  });

  it('SEED_DEMO names the workspace created', () => {
    expect(describeChange({ type: 'SEED_DEMO', after: { name: 'Demo — Maison Salam' } }).text)
      .toBe('Demo — Maison Salam');
  });

  it('DELETE_DEMO names the workspace destroyed', () => {
    expect(describeChange({ type: 'DELETE_DEMO', before: { name: 'Demo — old' } }).text)
      .toBe('Demo — old');
  });
});

describe('describeChange — nothing to say', () => {
  it.each([
    ['no payload at all', { type: 'CHANGE_ROLE' }],
    ['a plan row with neither side', { type: 'CHANGE_PLAN', before: {}, after: {} }],
    ['a seed row with no name', { type: 'SEED_DEMO', after: {} }],
    ['a delete row with no name', { type: 'DELETE_DEMO', before: {} }],
    ['an unknown type', { type: 'SOMETHING_NEW', before: { x: 1 }, after: { x: 2 } }],
    ['an empty object', {}],
    ['nothing', undefined],
  ])('says "—" for %s', (_label, log) => {
    expect(describeChange(log).text).toBe('—');
  });
});

describe('shortId', () => {
  it('truncates a uuid', () => expect(shortId('c52262ec-fed1-4697-8f7a-982efea99fb0')).toBe('c52262ec…'));
  it('leaves a short id whole', () => expect(shortId('ws-1')).toBe('ws-1'));
  it('has nothing to show for a missing id', () => expect(shortId(null)).toBe('—'));
});

describe('formatWhen', () => {
  it('renders a real timestamp', () => {
    expect(formatWhen('2026-07-27T10:00:00.000Z')).not.toBe('—');
  });

  // "Invalid Date" in an audit log looks like corrupted data.
  it.each([null, undefined, '', 'not-a-date'])('says "—" for %s', (v) => {
    expect(formatWhen(v)).toBe('—');
  });
});

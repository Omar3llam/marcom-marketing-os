// ============================================================
// Admin — list query-param parsing
// ------------------------------------------------------------
// Query strings are arbitrary input. Every case here is one that would
// otherwise reach Prisma as `take: NaN`, `skip: -1`, or an enum value that
// does not exist — all of which throw and surface as a 500 on a route where
// the honest answer is "that filter matched nothing".
// ============================================================
import { describe, it, expect } from 'vitest';
import { parseLimit, parseOffset, parseSearch, parseEnum } from './pagination.js';

describe('parseLimit', () => {
  it('accepts a number in range', () => {
    expect(parseLimit('10', { def: 25, max: 100 })).toBe(10);
  });

  it('caps at max', () => {
    expect(parseLimit('5000', { def: 25, max: 100 })).toBe(100);
  });

  it.each([['abc'], [''], [undefined], [null], ['0'], ['-5'], ['NaN']])(
    'falls back to the default for %s',
    (raw) => {
      expect(parseLimit(raw, { def: 25, max: 100 })).toBe(25);
    },
  );

  // Math.min(NaN, 100) is NaN, which Prisma rejects — the guard has to be a
  // Number.isFinite check, not a clamp.
  it('never returns NaN', () => {
    expect(Number.isNaN(parseLimit('abc', { def: 25, max: 100 }))).toBe(false);
  });

  it('truncates a float rather than passing it through', () => {
    expect(parseLimit('10.9', { def: 25, max: 100 })).toBe(10);
  });
});

describe('parseOffset', () => {
  it('accepts a non-negative number', () => {
    expect(parseOffset('50')).toBe(50);
    expect(parseOffset('0')).toBe(0);
  });

  it.each([['abc'], [undefined], [null], ['-1'], ['-999']])('clamps %s to 0', (raw) => {
    expect(parseOffset(raw)).toBe(0);
  });
});

describe('parseSearch', () => {
  it('returns a trimmed term', () => {
    expect(parseSearch('  acme  ')).toBe('acme');
  });

  // '   ' is not a search — it is a `contains` that quietly empties the list.
  it.each([[''], ['   '], [undefined], [null], [123]])('returns null for %s', (raw) => {
    expect(parseSearch(raw)).toBeNull();
  });
});

describe('parseEnum', () => {
  it('passes a permitted value through', () => {
    expect(parseEnum('ADMIN', ['ADMIN', 'VIEWER'])).toBe('ADMIN');
  });

  it.each([['SUPERUSER'], ['admin'], [''], [undefined], [null]])(
    'drops %s rather than forwarding it to Prisma',
    (raw) => {
      expect(parseEnum(raw, ['ADMIN', 'VIEWER'])).toBeNull();
    },
  );
});

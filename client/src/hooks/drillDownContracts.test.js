import { describe, expect, it } from 'vitest';
import { parseAdSetDrillDownResponse, parseAdsDrillDownResponse } from './drillDownContracts.js';
import { drillDownFailure } from './drillDownFailure.js';

describe.each([
  ['adSets', parseAdSetDrillDownResponse], ['children', parseAdsDrillDownResponse],
])('%s minimal success envelope', (list, parse) => {
  it.each([null, undefined, [], 'bad', 0, true])('rejects non-object root %j', (payload) => {
    expect(() => parse(payload)).toThrow('failed contract validation');
  });
  it('requires own entity and list properties', () => {
    expect(() => parse(Object.create({ entity: {}, [list]: [] }))).toThrow('failed contract validation');
    expect(() => parse(Object.assign(Object.create({ entity: {} }), { [list]: [] }))).toThrow('failed contract validation');
    expect(() => parse(Object.assign(Object.create({ [list]: [] }), { entity: {} }))).toThrow('failed contract validation');
  });
  it.each([undefined, false, {}, []])('rejects present invalid objective %j', (objective) => {
    expect(() => parse({ entity: {}, [list]: [], objective })).toThrow('failed contract validation');
  });
  it('preserves legacy fields, row order and absent metrics without child schema expansion', () => {
    const entity = { legacyField: true };
    const rows = [{ entityId: 'second', ctr: null }, { entityId: 'first' }];
    const parsed = parse({ entity, [list]: rows, futureField: true, objective: null });
    expect(parsed.entity).toBe(entity); expect(parsed[list]).toBe(rows);
    expect(parsed[list][0].ctr).toBeNull(); expect(parsed[list][1].ctr).toBeUndefined();
  });
});

describe('local drill-down failure policy', () => {
  it.each([{ httpStatus: 403 }, { response: { status: 403 } }])('uses HTTP evidence %j', (error) => {
    expect(drillDownFailure(error)).toEqual({ kind: 'NOT_PERMITTED', retryable: false });
  });
  it.each([401, 404, 408, 429, 500, 503, undefined])('preserves recovery for status %s', (httpStatus) => {
    expect(drillDownFailure({ httpStatus })).toEqual({ kind: 'UNAVAILABLE', retryable: true });
  });
  it.each([parseAdSetDrillDownResponse, parseAdsDrillDownResponse])('recognizes locally thrown contract error', (parse) => {
    try { parse({}); } catch (error) {
      expect(drillDownFailure(error)).toEqual({ kind: 'CONTRACT_INVALID', retryable: false });
    }
  });
  it('does not derive permission or contract identity from arbitrary backend prose', () => {
    expect(drillDownFailure(new Error('403 RoleForbidden; failed contract validation')))
      .toEqual({ kind: 'UNAVAILABLE', retryable: true });
    expect(drillDownFailure({ message: 'Ads drill-down response failed contract validation' }))
      .toEqual({ kind: 'UNAVAILABLE', retryable: true });
  });
});

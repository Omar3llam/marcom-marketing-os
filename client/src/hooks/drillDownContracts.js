const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const DRILL_DOWN_CONTRACT_ERRORS = Object.freeze([
  'Ad-set drill-down response failed contract validation',
  'Ads drill-down response failed contract validation',
]);

function parse(payload, listKey, message) {
  if (!isObject(payload) || !Object.hasOwn(payload, 'entity') || !isObject(payload.entity)
      || !Object.hasOwn(payload, listKey) || !Array.isArray(payload[listKey])
      || (Object.hasOwn(payload, 'objective') && payload.objective !== null && typeof payload.objective !== 'string')) {
    throw new Error(message);
  }
  return { entity: payload.entity, objective: payload.objective ?? null, [listKey]: payload[listKey] };
}

export const parseAdSetDrillDownResponse = (payload) => parse(payload, 'adSets', DRILL_DOWN_CONTRACT_ERRORS[0]);
export const parseAdsDrillDownResponse = (payload) => parse(payload, 'children', DRILL_DOWN_CONTRACT_ERRORS[1]);

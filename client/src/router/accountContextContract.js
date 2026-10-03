/** GET envelope truth only; completion remains owned by isOnboarded. */
export function parseAccountContextResponse(payload) {
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!isObject(payload) || !Object.hasOwn(payload, 'context')
      || (payload.context !== null && !isObject(payload.context))) {
    throw new Error('Account context response failed contract validation');
  }
  return payload.context;
}

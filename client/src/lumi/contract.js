// ============================================================
// LUMI primitives — the closed-API contract every part enforces
// ------------------------------------------------------------
// A primitive that accepts `className`, `style` or a `color` prop is a token
// system with a back door: one call site at a time, the architecture in
// DESIGN_TOKEN_ARCHITECTURE.md stops being true. So every LUMI part declares
// the props it understands and throws on anything else, in the same spirit as
// `absenceState()`: an input the contract does not name has no safe default.
//
// `aria-*` and `data-*` pass through, so accessibility and test hooks stay
// open. `data-lumi-*` is reserved: those attributes carry environment, state
// and verdict facts that the parts themselves set.
// ============================================================

/** Throws when `props` carries a key the component does not declare. */
export function assertProps(component, props, allowed) {
  for (const key of Object.keys(props)) {
    if (key === 'children' || allowed.includes(key)) continue;
    if (key.startsWith('data-lumi-')) {
      throw new Error(`${component}: "${key}" is reserved. LUMI parts set their own data-lumi-* facts.`);
    }
    if (key.startsWith('aria-') || key.startsWith('data-')) continue;
    throw new Error(
      `${component}: "${key}" is not part of its API. LUMI parts take semantic props only; `
      + 'appearance comes from the token system, never from the call site.',
    );
  }
}

/** Throws unless `value` is exactly one of `values`. No case folding. */
export function assertOneOf(component, prop, value, values) {
  if (!values.includes(value)) {
    throw new Error(
      `${component}: ${prop} "${String(value)}" is not one of ${values.join(' · ')}. `
      + 'An unrecognised value is refused, never mapped to a neighbour.',
    );
  }
}

/** Throws unless `value` is a non-empty string. */
export function assertText(component, prop, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${component}: ${prop} must be non-empty text.`);
  }
}

/** Throws when `value` is present. Used where a prop would contradict the state. */
export function assertAbsent(component, prop, value, why) {
  if (value !== undefined && value !== null) {
    throw new Error(`${component}: ${prop} is not allowed here — ${why}`);
  }
}

/** Joins CSS module class names, skipping falsy entries. */
export function cx(...names) {
  return names.filter(Boolean).join(' ');
}

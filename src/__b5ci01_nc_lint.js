// B5-CI-01 NC2a — TEMPORARY negative control. NEVER MERGE.
// A `no-undef` error, which eslint.config.js declares as 'error' (unused vars
// are only warnings, so this is the narrowest violation that actually fails
// `npm run lint`). Imported by nothing, so the backend suite is unaffected and
// the control proves the LINT step rather than "some CI job went red".
export function b5ci01NegativeControl() {
  return __b5ci01ThisIdentifierIsNeverDefined;
}

// ============================================================
// MARCOM Semantic Assemblies — Barrel Export
// ============================================================
// The Composition Layer: domain-specific assemblies of primitives.
//
// Architecture:
//   Primitives (atoms) → Assemblies (molecules) → Pages (organisms)
//
// Philosophy:
//   - Assemblies compose 3+ primitives
//   - Carry domain-specific meaning (not just layout)
//   - Used in 2+ places with stable API
//   - Reduce cognitive complexity
//
// Creation Gate:
//   See: ../primitives/PRIMITIVE-FREEZE.md
//   New assemblies must pass the same 4-gate rule as primitives.
// ============================================================

// Decision flow assemblies
export { DecisionTrustCluster } from './DecisionTrustCluster';

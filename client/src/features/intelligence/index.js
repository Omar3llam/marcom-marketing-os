export { default as BlendedTruth } from './blended-truth/BlendedTruthView.jsx';
export { BlendedTruthView } from './blended-truth/BlendedTruthView.jsx';
export { default as InsightsView } from './insights/InsightsView.jsx';
// FE-02 — `Proof` (the default page export) is gone: proof is Memory's second
// reading now, not a page. This barrel itself has no importer.
export { ProofSummary, ProofView, ProofReading } from './proof/ProofView.jsx';

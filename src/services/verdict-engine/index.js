export { evaluateVerdict, rollupVerdicts, aggregateMetrics, toSignalInput } from './verdictEngine.js';
export { VERDICT, VERDICT_TO_REC_TYPES, verdictToActionType }                from './verdictTypes.js';
export { getConnectorVerdicts, buildConnectorVerdictTree, hasMeasuredRevenue, needsRevenueData, revenueExpectedFor } from './connectorVerdictService.js';
// R8 — the ONE canonical evaluation, and the vocabulary for carrying it (and its
// failure) between the consumers of a single logical evaluation.
export { evaluateConnectorVerdicts, EVALUATION_FAILED, failedEvaluation, isEvaluated, assertUsableEvaluation } from './connectorVerdictService.js';
export { applyRelativeRanking } from './relativeRanking.js';
// Stage 1 evidence. `isRankable` and METRIC_THRESHOLDS travel WITH analyzeEvidence
// on purpose: a caller that must explain its null needs the same eligibility test
// and the same metric whitelist the analysis itself used.
export { analyzeEvidence, isRankable, METRIC_THRESHOLDS } from './evidenceProvider.js';

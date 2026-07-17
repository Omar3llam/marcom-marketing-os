export { evaluateVerdict, rollupVerdicts, aggregateMetrics, toSignalInput } from './verdictEngine.js';
export { VERDICT, VERDICT_TO_REC_TYPES, verdictToActionType }                from './verdictTypes.js';
export { getConnectorVerdicts, buildConnectorVerdictTree, hasMeasuredRevenue, needsRevenueData, revenueExpectedFor } from './connectorVerdictService.js';
export { applyRelativeRanking } from './relativeRanking.js';

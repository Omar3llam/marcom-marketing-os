// ============================================================
// decision-memory — the canonical decision-history reads
// ============================================================
// The directory name is historical. What lives here now is the DECISION SPINE:
// two reads over the `decisions` table, and nothing else.
//
// R7 removed what made the name misleading — DecisionMemoryService and
// memorySerializer, which wrote and read the separate `decision_memory` table.
// That table was a second, competing record of what Lumi had decided, and the
// surfaces reading it showed users verdicts no engine ever issued.
//
// Two reads, two questions, deliberately not merged:
//   getDecisionHistory  — "what did we say about THESE campaigns" (entity-scoped)
//   getRecentDecisions  — "what has Lumi decided lately here" (workspace-scoped)
// ============================================================
export {
  getDecisionHistory,
  HISTORY_LIMIT,
  HISTORY_STATUS,
  getRecentDecisions,
  RECENT_DECISIONS_LIMIT,
  RECENT_DECISION_SELECT,
} from './decisionHistory.js';

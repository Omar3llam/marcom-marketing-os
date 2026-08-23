-- SC-3 — DecisionMemory schema closure.
-- Production measured at 0 rows before this migration: no backfill, no archival.
--
-- One statement, and execution_requests is deliberately untouched. Both foreign
-- keys of this relationship live ON decision_memory — workspaceId -> workspaces
-- and executionId -> execution_requests — so DROP TABLE removes them with it.
-- `ExecutionRequest.decisionMemory` was a Prisma virtual back-relation and never
-- had a column; there is no decisionMemoryId anywhere to drop.

DROP TABLE IF EXISTS "decision_memory";

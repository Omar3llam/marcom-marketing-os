# Runtime Events Catalog

**Version:** 1.0
**Status:** Active
**Owner:** Execution Engine (`src/services/execution-engine/`)

This document is the authoritative reference for all events emitted by the MARCOM execution engine graph layer. All event emission in `src/services/execution-engine/` must use only the event types defined here. No other event type strings may be used.

---

## Approved Event Types

### `execution.started`

Emitted once when graph traversal begins. Fired at the start of `executeGraph()`.

| Field | Type | Description |
|-------|------|-------------|
| `eventType` | `string` | `"execution.started"` |
| `eventId` | `string` | Unique event ID (`evt_<base36-ts>_<random>`) |
| `timestamp` | `string` | ISO 8601 timestamp |
| `graphId` | `string` | Execution graph ID |
| `nodeCount` | `number` | Total number of nodes in the graph |

---

### `execution.transition`

Emitted on every node status change during traversal. A single graph execution produces multiple transition events — at minimum two per node (PENDING → RUNNING, then RUNNING → COMPLETED or RUNNING → FAILED), plus one per skipped node (PENDING → SKIPPED).

| Field | Type | Description |
|-------|------|-------------|
| `eventType` | `string` | `"execution.transition"` |
| `eventId` | `string` | Unique event ID |
| `timestamp` | `string` | ISO 8601 timestamp |
| `graphId` | `string` | Execution graph ID |
| `nodeId` | `string` | ID of the node that transitioned |
| `nodeLabel` | `string` | Human-readable node name |
| `transition.from` | `string` | Previous node status |
| `transition.to` | `string` | New node status |

---

### `execution.completed`

Emitted once when all nodes have reached a terminal status and **no** node is in `FAILED` state. A graph with some `SKIPPED` nodes (due to upstream dependency failures) still emits `execution.completed` if no node actually failed.

| Field | Type | Description |
|-------|------|-------------|
| `eventType` | `string` | `"execution.completed"` |
| `eventId` | `string` | Unique event ID |
| `timestamp` | `string` | ISO 8601 timestamp |
| `graphId` | `string` | Execution graph ID |
| `stats.completed` | `number` | Count of COMPLETED nodes |
| `stats.skipped` | `number` | Count of SKIPPED nodes |
| `stats.failed` | `number` | Count of FAILED nodes (always 0 for this event) |

---

### `execution.failed`

Emitted once when graph traversal ends with at least one node in `FAILED` state.

| Field | Type | Description |
|-------|------|-------------|
| `eventType` | `string` | `"execution.failed"` |
| `eventId` | `string` | Unique event ID |
| `timestamp` | `string` | ISO 8601 timestamp |
| `graphId` | `string` | Execution graph ID |
| `stats.completed` | `number` | Count of COMPLETED nodes |
| `stats.skipped` | `number` | Count of SKIPPED nodes |
| `stats.failed` | `number` | Count of FAILED nodes (always ≥1 for this event) |

---

## Event ID Format

All event IDs follow the format: `evt_<base36-timestamp>_<random-7-chars>`

Example: `evt_lqb3k2p_a8f3kz1`

This format matches `src/services/execution/lifecycleTelemetry.js` for consistency across the execution engine.

---

## Node Status Values

During graph traversal, each node moves through the following statuses:

| Status | Meaning |
|--------|---------|
| `PENDING` | Not yet executed (initial state) |
| `RUNNING` | Currently executing |
| `COMPLETED` | Execution succeeded |
| `FAILED` | Execution threw an error |
| `SKIPPED` | Not attempted because a dependency failed |

These are graph-layer statuses defined in `src/services/execution-engine/graph/ExecutionGraph.js`. They are **distinct** from `ExecutionStatus` in `@marcom/runtime-contracts`, which governs database-persisted execution requests.

---

## Forbidden Event Types

The following are **not** approved for the graph layer:

- Any event type string not listed in this document
- `execution.timeout` — lifecycle concern, belongs in `src/services/execution/`
- `execution.concurrency_violation` — lifecycle concern, belongs in `src/services/execution/`
- WebSocket or SSE broadcast events — routing to external transports is the caller's responsibility, not the graph layer's

Graph events are internal signals only. The graph layer emits to an optional in-process emitter function. Routing those events to SSE, queues, or external systems belongs to the layer above.

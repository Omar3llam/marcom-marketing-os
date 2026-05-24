import { NodeStatus } from './ExecutionGraph.js';
import { detectCycle } from './graphValidation.js';
import { GraphEventType, createGraphEvent, emitGraphEvent } from './graphEvents.js';

// Pure topological sort. Throws CycleDetectedError if the graph has a cycle.
// Same graph always produces the same order (ties broken alphabetically).
export function topologicalSort(graph) {
  return detectCycle(graph);
}

// Execute graph: traverse in topological order, running each node via nodeRunner.
//
// nodeRunner: async (node: ExecutionNode) => result
//   - Returning normally marks the node COMPLETED.
//   - Throwing marks the node FAILED; all transitive dependents become SKIPPED.
//
// emitter: optional (event: object) => void
//   - Receives execution.started, execution.transition, and execution.completed/failed events.
//   - See docs/runtime-events.md for event shapes.
//
// Returns: ExecutionNode[] (all nodes with updated status/result/error fields).
export async function executeGraph(graph, nodeRunner, emitter = null) {
  const order = topologicalSort(graph);

  emitGraphEvent(
    createGraphEvent(GraphEventType.STARTED, { graphId: graph.id, nodeCount: graph.size }),
    emitter,
  );

  for (const nodeId of order) {
    const node = graph.getNode(nodeId);
    const deps = graph.getDependencies(nodeId);

    const shouldSkip = deps.some(
      dep => dep.status === NodeStatus.FAILED || dep.status === NodeStatus.SKIPPED,
    );

    if (shouldSkip) {
      node.status = NodeStatus.SKIPPED;
      emitGraphEvent(
        createGraphEvent(GraphEventType.TRANSITION, {
          graphId: graph.id, nodeId: node.id, nodeLabel: node.label,
          transition: { from: NodeStatus.PENDING, to: NodeStatus.SKIPPED },
        }),
        emitter,
      );
      continue;
    }

    // PENDING → RUNNING
    node.status    = NodeStatus.RUNNING;
    node.startedAt = new Date().toISOString();
    emitGraphEvent(
      createGraphEvent(GraphEventType.TRANSITION, {
        graphId: graph.id, nodeId: node.id, nodeLabel: node.label,
        transition: { from: NodeStatus.PENDING, to: NodeStatus.RUNNING },
      }),
      emitter,
    );

    try {
      node.result      = await nodeRunner(node);
      node.status      = NodeStatus.COMPLETED;
      node.completedAt = new Date().toISOString();
      emitGraphEvent(
        createGraphEvent(GraphEventType.TRANSITION, {
          graphId: graph.id, nodeId: node.id, nodeLabel: node.label,
          transition: { from: NodeStatus.RUNNING, to: NodeStatus.COMPLETED },
        }),
        emitter,
      );
    } catch (err) {
      node.status      = NodeStatus.FAILED;
      node.error       = err;
      node.completedAt = new Date().toISOString();
      emitGraphEvent(
        createGraphEvent(GraphEventType.TRANSITION, {
          graphId: graph.id, nodeId: node.id, nodeLabel: node.label,
          transition: { from: NodeStatus.RUNNING, to: NodeStatus.FAILED },
        }),
        emitter,
      );
    }
  }

  const allNodes = graph.getNodes();
  const stats = {
    completed: allNodes.filter(n => n.status === NodeStatus.COMPLETED).length,
    failed:    allNodes.filter(n => n.status === NodeStatus.FAILED).length,
    skipped:   allNodes.filter(n => n.status === NodeStatus.SKIPPED).length,
  };

  emitGraphEvent(
    createGraphEvent(
      stats.failed > 0 ? GraphEventType.FAILED : GraphEventType.COMPLETED,
      { graphId: graph.id, stats },
    ),
    emitter,
  );

  return allNodes;
}

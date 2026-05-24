// Thrown when a graph contains a dependency cycle (not a valid DAG).
export class CycleDetectedError extends Error {
  constructor(involvedNodes) {
    super(`Cycle detected in execution graph involving nodes: [${involvedNodes.join(', ')}]`);
    this.name         = 'CycleDetectedError';
    this.involvedNodes = involvedNodes;
  }
}

// Validate graph structure: verifies all edge endpoints reference real nodes.
// Returns { valid: boolean, errors: string[] }
export function validateGraph(graph) {
  const errors  = [];
  const nodeIds = new Set(graph.getNodes().map(n => n.id));

  for (const edge of graph.getEdges()) {
    if (!nodeIds.has(edge.from)) errors.push(`Edge references unknown node "${edge.from}"`);
    if (!nodeIds.has(edge.to))   errors.push(`Edge references unknown node "${edge.to}"`);
  }

  for (const node of graph.getNodes()) {
    for (const dep of node.dependencies) {
      if (!nodeIds.has(dep)) errors.push(`Node "${node.id}" has unknown dependency "${dep}"`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// Topological sort via Kahn's algorithm.
// Throws CycleDetectedError if the graph contains a cycle.
// Returns node IDs in a valid execution order (deterministic: ties broken by lexicographic sort).
export function detectCycle(graph) {
  const nodes    = graph.getNodes();
  const inDegree = new Map(nodes.map(n => [n.id, 0]));

  for (const edge of graph.getEdges()) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  // Sort so nodes with equal in-degree are always processed in the same (alphabetical) order.
  const queue = nodes
    .filter(n => inDegree.get(n.id) === 0)
    .map(n => n.id)
    .sort();

  const processed = [];

  while (queue.length > 0) {
    const current = queue.shift();
    processed.push(current);

    const dependents = graph.getDependents(current).map(n => n.id).sort();
    for (const dep of dependents) {
      const updated = (inDegree.get(dep) ?? 1) - 1;
      inDegree.set(dep, updated);
      if (updated === 0) {
        // Insert in sorted position to maintain determinism without re-sorting the whole queue.
        const insertAt = queue.findIndex(id => id > dep);
        if (insertAt === -1) queue.push(dep);
        else queue.splice(insertAt, 0, dep);
      }
    }
  }

  if (processed.length !== nodes.length) {
    const cycleNodes = nodes
      .filter(n => !processed.includes(n.id))
      .map(n => n.id)
      .sort();
    throw new CycleDetectedError(cycleNodes);
  }

  return processed;
}

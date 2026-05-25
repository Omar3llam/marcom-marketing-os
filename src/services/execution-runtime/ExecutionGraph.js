// ============================================================
// ExecutionGraph — directed acyclic graph for runtime execution
// ============================================================
// Represents an execution plan as a graph data structure.
// Provides topological sorting for deterministic execution order.
//
// DETERMINISM:
//   - Topological sort is stable (same graph → same order)
//   - Node IDs are deterministic (based on position + type)
//   - Dependency tracking is immutable
//
// INPUT:
//   { nodes: ['node_type_1', ...], edges: [{ from, to }, ...] }
//
// OUTPUT:
//   ExecutionGraph instance with .getSortedNodes() method
// ============================================================
import { NODE_STATUS } from './runtimeEvents.js';

export class ExecutionGraph {
  constructor({ nodes, edges }) {
    this.edges = edges;

    // Support both string[] and object[] formats for nodes
    // String format: ['NODE_TYPE_1', 'NODE_TYPE_2', ...]
    // Object format: [{ type: 'NODE_TYPE_1', id?: string, requiresApproval?: boolean }, ...]
    this.nodes = nodes.map((node, index) => {
      // Normalize to object format
      const normalized = typeof node === 'string'
        ? { type: node }
        : node;

      // Generate ID if not provided
      const id = normalized.id || `${normalized.type}_${index}`;

      return {
        id,
        type: normalized.type,
        status: NODE_STATUS.PENDING,
        dependencies: [],
        dependents: [],
        // PR #29: Support requiresApproval flag for interruptible execution
        requiresApproval: normalized.requiresApproval || false,
      };
    });

    // Keep backward compatibility for nodeTypes (deprecated, use nodes)
    this.nodeTypes = nodes.map(n => typeof n === 'string' ? n : n.type);

    // Build dependency map
    this._buildDependencyMap();

    // Precompute sorted order (deterministic)
    this._sortedNodeIds = this._topologicalSort();
  }

  _buildDependencyMap() {
    // Build type-to-node map for edge resolution
    const typeToNodeMap = new Map();
    for (const node of this.nodes) {
      const key = node.type;
      if (!typeToNodeMap.has(key)) {
        typeToNodeMap.set(key, []);
      }
      typeToNodeMap.get(key).push(node);
    }

    // Map edges to node dependencies
    for (const edge of this.edges) {
      const fromNodes = typeToNodeMap.get(edge.from) || [];
      const toNodes = typeToNodeMap.get(edge.to) || [];

      for (const fromNode of fromNodes) {
        for (const toNode of toNodes) {
          toNode.dependencies.push(fromNode.id);
          fromNode.dependents.push(toNode.id);
        }
      }
    }
  }

  _topologicalSort() {
    const sorted = [];
    const visited = new Set();
    const inDegree = new Map();

    // Initialize in-degree map
    for (const node of this.nodes) {
      inDegree.set(node.id, node.dependencies.length);
    }

    // Collect nodes with no dependencies
    const queue = [];
    for (const node of this.nodes) {
      if (inDegree.get(node.id) === 0) {
        queue.push(node.id);
      }
    }

    // Kahn's algorithm (deterministic with stable input order)
    while (queue.length > 0) {
      const nodeId = queue.shift();
      sorted.push(nodeId);
      visited.add(nodeId);

      const node = this.nodes.find(n => n.id === nodeId);
      for (const dependentId of node.dependents) {
        const newDegree = inDegree.get(dependentId) - 1;
        inDegree.set(dependentId, newDegree);

        if (newDegree === 0) {
          queue.push(dependentId);
        }
      }
    }

    // Cycle detection
    if (sorted.length !== this.nodes.length) {
      throw new Error('ExecutionGraph: cycle detected in graph');
    }

    return sorted;
  }

  getSortedNodes() {
    return this._sortedNodeIds.map(id => this.nodes.find(n => n.id === id));
  }

  getNode(nodeId) {
    return this.nodes.find(n => n.id === nodeId);
  }

  updateNodeStatus(nodeId, status) {
    const node = this.getNode(nodeId);
    if (node) {
      node.status = status;
    }
  }

  getDependencies(nodeId) {
    const node = this.getNode(nodeId);
    return node ? node.dependencies.map(id => this.getNode(id)) : [];
  }

  getDependents(nodeId) {
    const node = this.getNode(nodeId);
    return node ? node.dependents.map(id => this.getNode(id)) : [];
  }

  /**
   * Get all nodes that transitively depend on the given node (PR #31).
   * Used for dependency cascade during selective re-execution.
   *
   * @param {string} nodeId - Node ID to find dependents for
   * @returns {string[]} Array of dependent node IDs (includes direct + transitive)
   */
  getAllDependents(nodeId) {
    const visited = new Set();
    const queue = [nodeId];

    while (queue.length > 0) {
      const currentId = queue.shift();
      const node = this.getNode(currentId);

      if (!node) continue;

      for (const dependentId of node.dependents) {
        if (!visited.has(dependentId)) {
          visited.add(dependentId);
          queue.push(dependentId);
        }
      }
    }

    return Array.from(visited);
  }

  areDependenciesMet(nodeId) {
    const dependencies = this.getDependencies(nodeId);
    return dependencies.every(dep => dep.status === NODE_STATUS.SUCCESS);
  }

  shouldSkipNode(nodeId) {
    const dependencies = this.getDependencies(nodeId);
    return dependencies.some(dep =>
      dep.status === NODE_STATUS.FAILURE || dep.status === NODE_STATUS.SKIPPED
    );
  }
}

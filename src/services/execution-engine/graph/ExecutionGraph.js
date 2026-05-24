// Node status values for execution graph traversal.
// Distinct from ExecutionStatus in @marcom/runtime-contracts (which is for DB-persisted requests).
export const NodeStatus = Object.freeze({
  PENDING:   'PENDING',
  RUNNING:   'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED:    'FAILED',
  SKIPPED:   'SKIPPED',
});

export class ExecutionNode {
  constructor({ id, label, dependencies = [], payload = {} }) {
    if (!id || typeof id !== 'string') throw new TypeError('ExecutionNode: id must be a non-empty string');
    if (!label || typeof label !== 'string') throw new TypeError('ExecutionNode: label must be a non-empty string');
    this.id           = id;
    this.label        = label;
    this.dependencies = Object.freeze([...dependencies]);
    this.payload      = payload;
    this.status       = NodeStatus.PENDING;
    this.result       = null;
    this.error        = null;
    this.startedAt    = null;
    this.completedAt  = null;
  }
}

export class ExecutionEdge {
  constructor({ from, to }) {
    if (!from || typeof from !== 'string') throw new TypeError('ExecutionEdge: from must be a non-empty string');
    if (!to || typeof to !== 'string')     throw new TypeError('ExecutionEdge: to must be a non-empty string');
    this.from = from;
    this.to   = to;
  }
}

// ExecutionEdge({ from: A, to: B }) means "A must complete before B runs."
// getDependencies(B) → returns A  (nodes B depends on)
// getDependents(A)   → returns B  (nodes unlocked by A)
export class ExecutionGraph {
  constructor({ id, nodes = [], edges = [] }) {
    if (!id || typeof id !== 'string') throw new TypeError('ExecutionGraph: id must be a non-empty string');
    this.id     = id;
    this._nodes = new Map();
    this._edges = [];
    for (const n of nodes) this.addNode(n);
    for (const e of edges) this.addEdge(e);
  }

  get size() { return this._nodes.size; }

  addNode(node) {
    if (!(node instanceof ExecutionNode)) throw new TypeError('addNode: expected an ExecutionNode instance');
    if (this._nodes.has(node.id))         throw new Error(`addNode: duplicate node id "${node.id}"`);
    this._nodes.set(node.id, node);
  }

  addEdge(edge) {
    if (!(edge instanceof ExecutionEdge)) throw new TypeError('addEdge: expected an ExecutionEdge instance');
    this._edges.push(edge);
  }

  getNode(id) {
    return this._nodes.get(id) ?? null;
  }

  getNodes() {
    return [...this._nodes.values()];
  }

  getEdges() {
    return [...this._edges];
  }

  getDependencies(nodeId) {
    return this._edges
      .filter(e => e.to === nodeId)
      .map(e => this._nodes.get(e.from))
      .filter(Boolean);
  }

  getDependents(nodeId) {
    return this._edges
      .filter(e => e.from === nodeId)
      .map(e => this._nodes.get(e.to))
      .filter(Boolean);
  }
}

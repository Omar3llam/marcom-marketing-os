// ============================================================
// Execution Graph — Deterministic Tests
// PR #15: graph primitives, traversal, validation, events
//
// Success criterion: same graph input = same execution order every time.
// ============================================================

import { describe, it, expect } from 'vitest';
import { ExecutionNode, ExecutionEdge, ExecutionGraph, NodeStatus } from './ExecutionGraph.js';
import { CycleDetectedError, validateGraph } from './graphValidation.js';
import { topologicalSort, executeGraph } from './graphTraversal.js';
import { GraphEventType } from './graphEvents.js';

// ── helpers ────────────────────────────────────────────────────────────────

function node(id, dependencies = []) {
  return new ExecutionNode({ id, label: `Node ${id}`, dependencies });
}

function graph(id, nodes, edgePairs = []) {
  const edges = edgePairs.map(([from, to]) => new ExecutionEdge({ from, to }));
  return new ExecutionGraph({ id, nodes, edges });
}

function recorder(order) {
  return async (n) => { order.push(n.id); return { ran: n.id }; };
}

// ── ExecutionGraph primitives ──────────────────────────────────────────────

describe('ExecutionGraph primitives', () => {
  it('rejects duplicate node IDs', () => {
    const g = graph('g', [node('A')]);
    expect(() => g.addNode(node('A'))).toThrow('duplicate node id');
  });

  it('getDependencies returns upstream nodes (edges pointing TO the node)', () => {
    const g = graph('g', [node('A'), node('B')], [['A', 'B']]);
    expect(g.getDependencies('B').map(n => n.id)).toEqual(['A']);
  });

  it('getDependents returns downstream nodes (edges pointing FROM the node)', () => {
    const g = graph('g', [node('A'), node('B')], [['A', 'B']]);
    expect(g.getDependents('A').map(n => n.id)).toEqual(['B']);
  });

  it('size reflects the number of nodes', () => {
    const g = graph('g', [node('A'), node('B'), node('C')]);
    expect(g.size).toBe(3);
  });

  it('getNodes returns all nodes', () => {
    const g = graph('g', [node('A'), node('B')]);
    expect(g.getNodes().map(n => n.id).sort()).toEqual(['A', 'B']);
  });

  it('new node starts with PENDING status', () => {
    expect(node('A').status).toBe(NodeStatus.PENDING);
  });

  it('rejects non-string node id', () => {
    expect(() => new ExecutionNode({ id: 123, label: 'X' })).toThrow(TypeError);
  });
});

// ── validateGraph ─────────────────────────────────────────────────────────

describe('validateGraph', () => {
  it('passes for a valid acyclic graph', () => {
    const g = graph('g', [node('A'), node('B')], [['A', 'B']]);
    expect(validateGraph(g)).toEqual({ valid: true, errors: [] });
  });

  it('fails when edge references unknown "from" node', () => {
    const g = graph('g', [node('B')], [['GHOST', 'B']]);
    const result = validateGraph(g);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('GHOST'))).toBe(true);
  });

  it('fails when edge references unknown "to" node', () => {
    const g = graph('g', [node('A')], [['A', 'GHOST']]);
    const result = validateGraph(g);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('GHOST'))).toBe(true);
  });

  it('accumulates multiple errors', () => {
    const g = graph('g', [node('A')], [['A', 'MISSING1'], ['A', 'MISSING2']]);
    const result = validateGraph(g);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ── detectCycle / topologicalSort ─────────────────────────────────────────

describe('topologicalSort', () => {
  it('linear chain A → B → C: produces A, B, C order', () => {
    const g = graph('g', [node('A'), node('B'), node('C')], [['A', 'B'], ['B', 'C']]);
    const order = topologicalSort(g);
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'));
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('C'));
  });

  it('is deterministic — identical calls produce identical results', () => {
    const g = graph('g',
      [node('C'), node('A'), node('B')],
      [['A', 'C'], ['B', 'C']],
    );
    expect(topologicalSort(g)).toEqual(topologicalSort(g));
  });

  it('sorts independent nodes alphabetically for determinism', () => {
    const g = graph('g', [node('C'), node('B'), node('A')]);
    const order = topologicalSort(g);
    expect(order).toEqual(['A', 'B', 'C']);
  });

  it('rejects 2-node cycle', () => {
    const g = graph('g', [node('A'), node('B')], [['A', 'B'], ['B', 'A']]);
    expect(() => topologicalSort(g)).toThrow(CycleDetectedError);
  });

  it('rejects 3-node cycle', () => {
    const g = graph('g',
      [node('A'), node('B'), node('C')],
      [['A', 'B'], ['B', 'C'], ['C', 'A']],
    );
    expect(() => topologicalSort(g)).toThrow(CycleDetectedError);
  });

  it('rejects self-loop', () => {
    const g = graph('g', [node('A')], [['A', 'A']]);
    expect(() => topologicalSort(g)).toThrow(CycleDetectedError);
  });

  it('CycleDetectedError names the involved nodes', () => {
    const g = graph('g', [node('A'), node('B')], [['A', 'B'], ['B', 'A']]);
    expect(() => topologicalSort(g)).toThrow(/A.*B|B.*A/);
  });
});

// ── executeGraph — linear traversal ───────────────────────────────────────

describe('executeGraph — linear traversal', () => {
  it('executes A → B → C in topological order', async () => {
    const order = [];
    const g = graph('g', [node('A'), node('B'), node('C')], [['A', 'B'], ['B', 'C']]);
    await executeGraph(g, recorder(order));
    expect(order).toEqual(['A', 'B', 'C']);
  });

  it('marks all nodes COMPLETED on full success', async () => {
    const g = graph('g', [node('A'), node('B')], [['A', 'B']]);
    await executeGraph(g, async () => ({}));
    expect(g.getNode('A').status).toBe(NodeStatus.COMPLETED);
    expect(g.getNode('B').status).toBe(NodeStatus.COMPLETED);
  });

  it('stores runner return value in node.result', async () => {
    const g = graph('g', [node('A')]);
    await executeGraph(g, async () => ({ answer: 42 }));
    expect(g.getNode('A').result).toEqual({ answer: 42 });
  });

  it('records startedAt and completedAt timestamps', async () => {
    const g = graph('g', [node('A')]);
    await executeGraph(g, async () => ({}));
    expect(g.getNode('A').startedAt).toBeTruthy();
    expect(g.getNode('A').completedAt).toBeTruthy();
  });
});

// ── executeGraph — dependency ordering ────────────────────────────────────

describe('executeGraph — dependency ordering', () => {
  it('diamond: A → B, A → C, B → D, C → D executes A first and D last', async () => {
    const order = [];
    const g = graph('g',
      [node('A'), node('B'), node('C'), node('D')],
      [['A', 'B'], ['A', 'C'], ['B', 'D'], ['C', 'D']],
    );
    await executeGraph(g, recorder(order));
    expect(order[0]).toBe('A');
    expect(order[order.length - 1]).toBe('D');
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'));
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('C'));
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('D'));
    expect(order.indexOf('C')).toBeLessThan(order.indexOf('D'));
  });

  it('independent nodes run in alphabetical order', async () => {
    const order = [];
    const g = graph('g', [node('C'), node('A'), node('B')]);
    await executeGraph(g, recorder(order));
    expect(order).toEqual(['A', 'B', 'C']);
  });
});

// ── executeGraph — failed node propagation ────────────────────────────────

describe('executeGraph — failed node propagation', () => {
  it('marks dependent node SKIPPED when its dependency fails', async () => {
    const g = graph('g',
      [node('A'), node('B'), node('C')],
      [['A', 'B'], ['B', 'C']],
    );
    await executeGraph(g, async (n) => {
      if (n.id === 'B') throw new Error('B failed');
      return {};
    });
    expect(g.getNode('A').status).toBe(NodeStatus.COMPLETED);
    expect(g.getNode('B').status).toBe(NodeStatus.FAILED);
    expect(g.getNode('C').status).toBe(NodeStatus.SKIPPED);
  });

  it('stores the thrown error on the failed node', async () => {
    const cause = new Error('intentional failure');
    const g = graph('g', [node('A')]);
    await executeGraph(g, async () => { throw cause; });
    expect(g.getNode('A').error).toBe(cause);
  });

  it('propagates skip transitively (A fails → B skipped → C skipped)', async () => {
    const g = graph('g',
      [node('A'), node('B'), node('C')],
      [['A', 'B'], ['B', 'C']],
    );
    await executeGraph(g, async (n) => {
      if (n.id === 'A') throw new Error('A failed');
      return {};
    });
    expect(g.getNode('A').status).toBe(NodeStatus.FAILED);
    expect(g.getNode('B').status).toBe(NodeStatus.SKIPPED);
    expect(g.getNode('C').status).toBe(NodeStatus.SKIPPED);
  });

  it('unrelated branches still execute when one branch fails', async () => {
    // A → B (B will fail), C is independent
    const g = graph('g',
      [node('A'), node('B'), node('C')],
      [['A', 'B']],
    );
    await executeGraph(g, async (n) => {
      if (n.id === 'B') throw new Error('B failed');
      return {};
    });
    expect(g.getNode('A').status).toBe(NodeStatus.COMPLETED);
    expect(g.getNode('B').status).toBe(NodeStatus.FAILED);
    expect(g.getNode('C').status).toBe(NodeStatus.COMPLETED);
  });
});

// ── executeGraph — event emission ─────────────────────────────────────────

describe('executeGraph — event emission', () => {
  it('emits execution.started as the first event', async () => {
    const events = [];
    const g = graph('g', [node('A')]);
    await executeGraph(g, async () => ({}), e => events.push(e));
    expect(events[0].eventType).toBe(GraphEventType.STARTED);
  });

  it('emits execution.completed (not failed) when all nodes succeed', async () => {
    const events = [];
    const g = graph('g', [node('A')]);
    await executeGraph(g, async () => ({}), e => events.push(e));
    const types = events.map(e => e.eventType);
    expect(types).toContain(GraphEventType.COMPLETED);
    expect(types).not.toContain(GraphEventType.FAILED);
  });

  it('emits execution.failed (not completed) when a node fails', async () => {
    const events = [];
    const g = graph('g', [node('A')]);
    await executeGraph(g, async () => { throw new Error('x'); }, e => events.push(e));
    const types = events.map(e => e.eventType);
    expect(types).toContain(GraphEventType.FAILED);
    expect(types).not.toContain(GraphEventType.COMPLETED);
  });

  it('emits PENDING → RUNNING and RUNNING → COMPLETED transition events', async () => {
    const events = [];
    const g = graph('g', [node('A')]);
    await executeGraph(g, async () => ({}), e => events.push(e));
    const transitions = events.filter(e => e.eventType === GraphEventType.TRANSITION);
    expect(transitions.find(e => e.transition?.to === NodeStatus.RUNNING)).toBeTruthy();
    expect(transitions.find(e => e.transition?.to === NodeStatus.COMPLETED)).toBeTruthy();
  });

  it('emits PENDING → SKIPPED transition for skipped nodes', async () => {
    const events = [];
    const g = graph('g', [node('A'), node('B')], [['A', 'B']]);
    await executeGraph(g, async () => { throw new Error('x'); }, e => events.push(e));
    const transitions = events.filter(e => e.eventType === GraphEventType.TRANSITION);
    expect(transitions.find(e => e.transition?.to === NodeStatus.SKIPPED)).toBeTruthy();
  });

  it('carries graphId and nodeId in transition events', async () => {
    const events = [];
    const g = graph('my-graph', [node('A')]);
    await executeGraph(g, async () => ({}), e => events.push(e));
    const transition = events.find(e => e.eventType === GraphEventType.TRANSITION);
    expect(transition.graphId).toBe('my-graph');
    expect(transition.nodeId).toBe('A');
  });

  it('carries stats in the terminal event', async () => {
    const events = [];
    const g = graph('g', [node('A'), node('B')], [['A', 'B']]);
    await executeGraph(g, async (n) => {
      if (n.id === 'A') throw new Error('x');
      return {};
    }, e => events.push(e));
    const terminal = events.find(e =>
      e.eventType === GraphEventType.FAILED || e.eventType === GraphEventType.COMPLETED,
    );
    expect(terminal.stats.failed).toBe(1);
    expect(terminal.stats.skipped).toBe(1);
    expect(terminal.stats.completed).toBe(0);
  });

  it('works without an emitter (no-op, no errors thrown)', async () => {
    const g = graph('g', [node('A')]);
    await expect(executeGraph(g, async () => ({}))).resolves.toBeTruthy();
  });

  it('each event has a unique eventId', async () => {
    const events = [];
    const g = graph('g', [node('A'), node('B')], [['A', 'B']]);
    await executeGraph(g, async () => ({}), e => events.push(e));
    const ids = events.map(e => e.eventId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

// ── cycle detection rejection ──────────────────────────────────────────────

describe('cycle detection rejection', () => {
  it('rejects a 2-node mutual dependency', () => {
    const g = graph('g', [node('A'), node('B')], [['A', 'B'], ['B', 'A']]);
    expect(() => topologicalSort(g)).toThrow(CycleDetectedError);
  });

  it('rejects a 3-node cycle', () => {
    const g = graph('g',
      [node('A'), node('B'), node('C')],
      [['A', 'B'], ['B', 'C'], ['C', 'A']],
    );
    expect(() => topologicalSort(g)).toThrow(CycleDetectedError);
  });

  it('rejects a self-loop', () => {
    const g = graph('g', [node('A')], [['A', 'A']]);
    expect(() => topologicalSort(g)).toThrow(CycleDetectedError);
  });

  it('CycleDetectedError is named correctly', () => {
    const g = graph('g', [node('A')], [['A', 'A']]);
    try {
      topologicalSort(g);
    } catch (err) {
      expect(err.name).toBe('CycleDetectedError');
      expect(err).toBeInstanceOf(CycleDetectedError);
    }
  });
});

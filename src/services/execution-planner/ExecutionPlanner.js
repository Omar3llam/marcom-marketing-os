// ============================================================
// ExecutionPlanner
// ============================================================
// Single public API: buildExecutionPlan(input)
//
// ── STATUS: FUTURE-STAGE, NOT PRODUCTION-WIRED ──────────────────────────────
// Nothing in a request path calls buildExecutionPlan today. Its only caller
// outside this directory is execution-runtime/testNewAngle.integration.test.js,
// which exercises the planner → runtime handoff end to end.
//
// That is deliberate, and it is NOT an argument for deleting this. The module
// is the declarative half of execution planning — recommendations in, a node/
// edge graph out — and the runtime that consumes such a graph already exists.
// What has not been built is the production path that produces the input.
//
// So: a grep showing "no production callers" is expected here and is not
// evidence of dead code. Retained intentionally for the execution-planning
// work it was built ahead of, along with planTypes.js, recommendationMappings.js
// and the fixtures. Delete only as part of a decision to abandon that work,
// never as part of a cleanup sweep.
//
// DETERMINISM CONTRACT:
//   Given the same input, always produces the same output.
//   No randomness. No timestamps. No UUIDs.
//
// ISOLATION CONTRACT:
//   Never writes to DB. Never enqueues jobs. Never calls workers.
//   Callers own execution — this only builds declarative plans.
//
// INPUT:
//   {
//     diagnosis: string,
//     recommendations: [{ type, priority, rationale }, ...]
//   }
//
// OUTPUT:
//   {
//     diagnosis: string,
//     executionType: string,
//     priority: string,
//     graph: { nodes: [...], edges: [...] }
//   }
// ============================================================
import { REC_TYPE }                     from '../recommendation-engine/index.js';
import { RECOMMENDATION_TO_EXECUTION }  from './recommendationMappings.js';
import { logger }                        from '../../utils/logger.js';

const VALID_REC_TYPES = new Set(Object.values(REC_TYPE));

function validateInput(input) {
  if (input === null || input === undefined || typeof input !== 'object') {
    throw new Error('buildExecutionPlan: input must be a non-null object');
  }

  const { diagnosis, recommendations } = input;

  if (typeof diagnosis !== 'string' || !diagnosis.trim()) {
    throw new Error('buildExecutionPlan: diagnosis must be a non-empty string');
  }

  if (!Array.isArray(recommendations)) {
    throw new Error('buildExecutionPlan: recommendations must be an array');
  }

  if (recommendations.length === 0) {
    throw new Error('buildExecutionPlan: recommendations array cannot be empty');
  }

  for (let i = 0; i < recommendations.length; i++) {
    const rec = recommendations[i];
    if (typeof rec !== 'object' || rec === null) {
      throw new Error(`buildExecutionPlan: recommendations[${i}] must be a non-null object`);
    }
    if (typeof rec.type !== 'string' || !rec.type.trim()) {
      throw new Error(`buildExecutionPlan: recommendations[${i}].type is required`);
    }
    if (!VALID_REC_TYPES.has(rec.type)) {
      throw new Error(`buildExecutionPlan: unknown recommendation type "${rec.type}"`);
    }
    if (typeof rec.priority !== 'string' || !rec.priority.trim()) {
      throw new Error(`buildExecutionPlan: recommendations[${i}].priority is required`);
    }
  }
}

function deduplicateRecommendations(recommendations) {
  const seen = new Set();
  const deduplicated = [];

  for (const rec of recommendations) {
    if (!seen.has(rec.type)) {
      seen.add(rec.type);
      deduplicated.push(rec);
    }
  }

  return deduplicated;
}

function mergeGraphs(graphs) {
  const allNodes = [];
  const allEdges = [];
  const seenNodes = new Set();
  const seenEdges = new Set();

  for (const graph of graphs) {
    for (const node of graph.nodes) {
      if (!seenNodes.has(node)) {
        seenNodes.add(node);
        allNodes.push(node);
      }
    }

    for (const edge of graph.edges) {
      const edgeKey = `${edge.from}→${edge.to}`;
      if (!seenEdges.has(edgeKey)) {
        seenEdges.add(edgeKey);
        allEdges.push(edge);
      }
    }
  }

  return { nodes: allNodes, edges: allEdges };
}

function determineHighestPriority(recommendations) {
  const priorityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  let highest = 'LOW';
  let highestScore = 1;

  for (const rec of recommendations) {
    const score = priorityOrder[rec.priority] || 0;
    if (score > highestScore) {
      highest = rec.priority;
      highestScore = score;
    }
  }

  return highest;
}

function determineExecutionType(recommendations) {
  // If only one recommendation, use its execution type
  if (recommendations.length === 1) {
    const mapping = RECOMMENDATION_TO_EXECUTION[recommendations[0].type];
    return mapping.executionType;
  }

  // If multiple recommendations, check if they all map to the same execution type
  const executionTypes = new Set(
    recommendations.map(rec => RECOMMENDATION_TO_EXECUTION[rec.type].executionType)
  );

  if (executionTypes.size === 1) {
    return [...executionTypes][0];
  }

  // Mixed execution types → use first recommendation's type as primary
  const mapping = RECOMMENDATION_TO_EXECUTION[recommendations[0].type];
  return mapping.executionType;
}

/**
 * Converts recommendations into a deterministic execution plan.
 *
 * @param {{ diagnosis: string, recommendations: Array<{ type: string, priority: string, rationale: string }> }} input
 * @returns {{ diagnosis: string, executionType: string, priority: string, graph: { nodes: string[], edges: Array<{ from: string, to: string }> } }}
 */
export function buildExecutionPlan(input) {
  validateInput(input);

  const { diagnosis, recommendations } = input;

  // Deduplicate recommendations (preserve order, remove duplicates)
  const uniqueRecommendations = deduplicateRecommendations(recommendations);

  // Map each recommendation to its graph template
  const graphs = uniqueRecommendations.map(rec => {
    const mapping = RECOMMENDATION_TO_EXECUTION[rec.type];
    return {
      nodes: [...mapping.nodes],
      edges: mapping.edges.map(e => ({ ...e })),
    };
  });

  // Merge all graphs into a single execution graph
  const mergedGraph = mergeGraphs(graphs);

  // Determine execution type and priority
  const executionType = determineExecutionType(uniqueRecommendations);
  const priority = determineHighestPriority(uniqueRecommendations);

  logger.debug({
    diagnosis,
    recommendationCount: uniqueRecommendations.length,
    executionType,
    priority,
    nodeCount: mergedGraph.nodes.length,
  }, '[ExecutionPlanner] plan generated');

  return {
    diagnosis,
    executionType,
    priority,
    graph: mergedGraph,
  };
}

// ============================================================
// RuntimeOrchestrator — execution runtime coordinator
// ============================================================
// Single public API: executeExecutionPlan(plan, context)
//
// DETERMINISM CONTRACT:
//   Given the same plan + context, always produces:
//   - same execution order
//   - same event sequence
//   - same retry behavior
//   - same skip logic
//
// ISOLATION CONTRACT:
//   Never writes to DB. Never enqueues jobs. Never calls SSE.
//   Executors are pure-ish — all side effects happen here.
//
// INPUT:
//   plan: { diagnosis, executionType, priority, graph: { nodes, edges } }
//   context: { diagnosis, executionType, [additionalContext] }
//
// OUTPUT:
//   {
//     status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILURE',
//     executedNodes: [{ nodeId, nodeType, status, output, artifacts, attempts }],
//     events: [{ type, nodeId, attempt }],
//     summary: { totalNodes, successful, failed, skipped }
//   }
// ============================================================
import { ExecutionGraph }         from './ExecutionGraph.js';
import { getExecutor }            from './NodeExecutorRegistry.js';
import { RUNTIME_EVENT, EXECUTION_STATUS, NODE_STATUS } from './runtimeEvents.js';
import { logger }                 from '../../utils/logger.js';

const MAX_RETRIES = 3;

function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('executeExecutionPlan: plan must be a non-null object');
  }

  const { diagnosis, executionType, priority, graph } = plan;

  if (typeof diagnosis !== 'string' || !diagnosis.trim()) {
    throw new Error('executeExecutionPlan: diagnosis must be a non-empty string');
  }

  if (typeof executionType !== 'string' || !executionType.trim()) {
    throw new Error('executeExecutionPlan: executionType must be a non-empty string');
  }

  if (typeof priority !== 'string' || !priority.trim()) {
    throw new Error('executeExecutionPlan: priority must be a non-empty string');
  }

  if (!graph || typeof graph !== 'object') {
    throw new Error('executeExecutionPlan: graph must be a non-null object');
  }

  if (!Array.isArray(graph.nodes)) {
    throw new Error('executeExecutionPlan: graph.nodes must be an array');
  }

  if (!Array.isArray(graph.edges)) {
    throw new Error('executeExecutionPlan: graph.edges must be an array');
  }
}

async function executeNode(node, context, attempt = 1) {
  try {
    const executor = getExecutor(node.type);
    const result = await executor(node.id, node.type, context);

    if (!result || typeof result !== 'object') {
      throw new Error(`Executor for ${node.type} returned invalid result`);
    }

    if (typeof result.success !== 'boolean') {
      throw new Error(`Executor for ${node.type} missing success field`);
    }

    return result;
  } catch (error) {
    logger.error({
      nodeId: node.id,
      nodeType: node.type,
      attempt,
      error: error.message,
    }, '[RuntimeOrchestrator] node execution failed');

    return {
      success: false,
      output: { error: error.message },
      artifacts: [],
    };
  }
}

export async function executeExecutionPlan(plan, context = {}) {
  validatePlan(plan);

  const { diagnosis, executionType, priority, graph } = plan;

  // Build execution graph
  const executionGraph = new ExecutionGraph(graph);
  const sortedNodes = executionGraph.getSortedNodes();

  // Initialize execution state
  const events = [];
  const executedNodes = [];

  // Emit execution start
  events.push({ type: RUNTIME_EVENT.EXECUTION_START });

  logger.debug({
    diagnosis,
    executionType,
    priority,
    nodeCount: sortedNodes.length,
  }, '[RuntimeOrchestrator] execution started');

  // Execute nodes in topological order
  for (const node of sortedNodes) {
    // Check if node should be skipped due to failed dependencies
    if (executionGraph.shouldSkipNode(node.id)) {
      executionGraph.updateNodeStatus(node.id, NODE_STATUS.SKIPPED);
      events.push({ type: RUNTIME_EVENT.NODE_SKIPPED, nodeId: node.id });

      executedNodes.push({
        nodeId: node.id,
        nodeType: node.type,
        status: NODE_STATUS.SKIPPED,
        output: { reason: 'dependency_failed' },
        artifacts: [],
        attempts: 0,
      });

      logger.debug({ nodeId: node.id, nodeType: node.type }, '[RuntimeOrchestrator] node skipped');
      continue;
    }

    // Execute node with retries
    executionGraph.updateNodeStatus(node.id, NODE_STATUS.RUNNING);
    events.push({ type: RUNTIME_EVENT.NODE_START, nodeId: node.id, attempt: 1 });

    let result = null;
    let attempts = 0;
    let finalStatus = NODE_STATUS.FAILURE;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      attempts = attempt;

      if (attempt > 1) {
        events.push({ type: RUNTIME_EVENT.NODE_RETRY, nodeId: node.id, attempt });
        logger.debug({ nodeId: node.id, attempt }, '[RuntimeOrchestrator] retrying node');
      }

      result = await executeNode(node, { diagnosis, executionType, ...context }, attempt);

      if (result.success) {
        finalStatus = NODE_STATUS.SUCCESS;
        executionGraph.updateNodeStatus(node.id, NODE_STATUS.SUCCESS);
        events.push({ type: RUNTIME_EVENT.NODE_SUCCESS, nodeId: node.id, attempt });

        logger.debug({
          nodeId: node.id,
          nodeType: node.type,
          attempt,
        }, '[RuntimeOrchestrator] node succeeded');

        break;
      }

      // Failed — check if we should retry
      if (attempt === MAX_RETRIES) {
        finalStatus = NODE_STATUS.FAILURE;
        executionGraph.updateNodeStatus(node.id, NODE_STATUS.FAILURE);
        events.push({ type: RUNTIME_EVENT.NODE_FAILURE, nodeId: node.id, attempt });

        logger.warn({
          nodeId: node.id,
          nodeType: node.type,
          attempts,
        }, '[RuntimeOrchestrator] node failed after max retries');
      }
    }

    executedNodes.push({
      nodeId: node.id,
      nodeType: node.type,
      status: finalStatus,
      output: result?.output || {},
      artifacts: result?.artifacts || [],
      attempts,
    });
  }

  // Calculate summary
  const summary = {
    totalNodes: sortedNodes.length,
    successful: executedNodes.filter(n => n.status === NODE_STATUS.SUCCESS).length,
    failed: executedNodes.filter(n => n.status === NODE_STATUS.FAILURE).length,
    skipped: executedNodes.filter(n => n.status === NODE_STATUS.SKIPPED).length,
  };

  // Determine overall status
  let status = EXECUTION_STATUS.SUCCESS;
  if (summary.failed > 0) {
    status = summary.successful > 0 ? EXECUTION_STATUS.PARTIAL_SUCCESS : EXECUTION_STATUS.FAILURE;
  } else if (summary.skipped > 0 && summary.successful === 0) {
    status = EXECUTION_STATUS.FAILURE;
  }

  events.push({ type: RUNTIME_EVENT.EXECUTION_SUCCESS, status });

  logger.info({
    status,
    summary,
  }, '[RuntimeOrchestrator] execution completed');

  return {
    status,
    executedNodes,
    events,
    summary,
  };
}

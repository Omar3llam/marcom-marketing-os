/**
 * FSM Async Services (Phase 11)
 *
 * Actor implementations for async operations in the state machine.
 * Handles API calls, validation, and polling.
 */
import { api } from '@/lib/api';
import { parseLumiFeed } from '@/contracts/adapters';
import { ValidationError, PlatformError } from '@/contracts/errors';
import type { LumiFeedResponse } from '@/contracts/schemas';

// ══════════════════════════════════════════════════════════════
// Service Input/Output Types
// ══════════════════════════════════════════════════════════════

export interface ValidateInputArgs {
  data: any;
  mode: string;
}

export interface ValidateInputResult {
  valid: boolean;
  data: any;
}

export interface PlanExecutionArgs {
  data: any;
  mode: string;
}

export interface PlanExecutionResult {
  plan: LumiFeedResponse;
  actionId: string;
  idempotencyKey: string;
}

export interface ExecuteActionArgs {
  actionId: string;
  idempotencyKey: string;
  actionType: string;
  targetId: string;
  targetType: string;
  options?: Record<string, any>;
}

export interface ExecuteActionResult {
  success: boolean;
  actionId: string;
  auditLogId?: string;
  status: string;
  data?: any;
  error?: string;
}

export interface PollExecutionStatusArgs {
  actionId: string;
}

export interface PollExecutionStatusResult {
  status: 'QUEUED' | 'EXECUTING' | 'EXECUTED_SUCCESS' | 'EXECUTED_FAILED' | 'PENDING';
  actionId: string;
  error?: any;
  data?: any;
}

// ══════════════════════════════════════════════════════════════
// Service Implementations
// ══════════════════════════════════════════════════════════════

/**
 * Validate input data before planning
 *
 * @param args - Input data and mode
 * @returns Validated data
 * @throws ValidationError if invalid
 */
export async function validateInput(args: ValidateInputArgs): Promise<ValidateInputResult> {
  const { data, mode } = args;

  // Basic validation
  if (!data) {
    throw new ValidationError({
      message: 'Input data is required',
      code: 'VALIDATION_MISSING_DATA',
      fallbackAction: 'Provide input data',
    });
  }

  if (!mode || !['csv', 'meta', 'campaign'].includes(mode)) {
    throw new ValidationError({
      message: `Invalid mode: ${mode}`,
      code: 'VALIDATION_INVALID_MODE',
      fallbackAction: 'Select a valid mode (csv, meta, or campaign)',
    });
  }

  // Mode-specific validation
  if (mode === 'csv' && !data.campaigns) {
    throw new ValidationError({
      message: 'CSV mode requires campaigns array',
      code: 'VALIDATION_CSV_NO_CAMPAIGNS',
      fallbackAction: 'Upload a valid CSV file',
    });
  }

  if (mode === 'campaign' && !data.campaignId) {
    throw new ValidationError({
      message: 'Campaign mode requires campaignId',
      code: 'VALIDATION_CAMPAIGN_NO_ID',
      fallbackAction: 'Select a campaign',
    });
  }

  return { valid: true, data };
}

/**
 * Plan execution by calling orchestrator
 *
 * @param args - Input data and mode
 * @returns Execution plan with action IDs
 * @throws PlatformError if orchestrator fails
 */
export async function planExecution(args: PlanExecutionArgs): Promise<PlanExecutionResult> {
  const { data, mode } = args;

  try {
    // Fetch context lock (CMO memory)
    let contextLock = null;
    try {
      const contextResponse = await api.get('/api/campaigns/me/context');
      contextLock = contextResponse.data?.context ?? null;
    } catch (err) {
      console.warn('[FSM] Context fetch failed, proceeding without:', err);
    }

    // Call mode-specific orchestrator endpoint
    let response;
    if (mode === 'campaign') {
      const campaignId = data?.campaignId;
      if (!campaignId) {
        throw new ValidationError({
          message: 'No campaign selected',
          code: 'VALIDATION_NO_CAMPAIGN',
          fallbackAction: 'Upload CSV and select a campaign',
        });
      }

      response = await api.post(
        `/api/lumi/orchestrate/${encodeURIComponent(campaignId)}`,
        { contextLock },
        { timeout: 60_000 }
      );
    } else if (mode === 'content') {
      response = await api.post(
        '/api/lumi/analyze-content',
        {
          content: data?.text,
          platform: data?.platform,
          contextLock,
        },
        { timeout: 30_000 }
      );
    } else if (mode === 'strategy') {
      response = await api.post(
        '/api/lumi/strategy-brief',
        { ...data, contextLock },
        { timeout: 45_000 }
      );
    } else {
      throw new ValidationError({
        message: `Unknown mode: ${mode}`,
        code: 'VALIDATION_UNKNOWN_MODE',
        fallbackAction: 'Select a valid mode',
      });
    }

    // Generate action ID and idempotency key
    const actionId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();

    // Map backend response to DecisionContract format
    const plan = mapOrchestratorResponse(response.data, mode, data);

    return {
      plan,
      actionId,
      idempotencyKey,
    };
  } catch (error: any) {
    // Re-throw domain errors
    if (error.classification) {
      throw error;
    }

    // Wrap unknown errors
    throw new PlatformError({
      message: error.message || 'Orchestrator planning failed',
      code: 'ORCHESTRATOR_PLANNING_FAILED',
      fallbackAction: 'Retry or contact support',
      cause: error,
    });
  }
}

/**
 * Map backend orchestrator response to LumiFeedResponse format
 */
function mapOrchestratorResponse(data: any, mode: string, inputData: any): LumiFeedResponse {
  const a = data?.strategicAnalysis || {};
  const verdict = normalizeVerdict(a.verdict);
  const why = Array.isArray(a.diagnosis)
    ? a.diagnosis
    : a.diagnosis
    ? [a.diagnosis]
    : Array.isArray(a.whyBreakdown)
    ? a.whyBreakdown
    : [];
  const action = a.actionPlan?.action || a.actionPlan?.expectedImpact || 'Approve & Execute';
  const impact = a.actionPlan?.expectedImpact || 'Awaiting financial-impact estimate';

  return {
    campaigns: [
      {
        id: String(inputData?.campaignId || 'unknown'),
        name: `Campaign · ${String(inputData?.campaignId || 'unknown').slice(-8).toUpperCase()}`,
        status: 'ACTIVE',
        budget: 0,
        spend: 0,
        roas: 0,
        alerts: [
          {
            id: crypto.randomUUID(),
            action_id: crypto.randomUUID(),
            idempotency_key: crypto.randomUUID(),
            verdict,
            confidence: Number(a.confidence) || getVerdictDefaults(verdict).confidence,
            riskLevel: a.riskLevel || getVerdictDefaults(verdict).risk,
            diagnosis: why.slice(0, 5),
            actionPlan: {
              action,
              expectedImpact: impact,
            },
            creativeAssets: data?.creativeAssets ?? null,
            timestamp: data?.orchestratedAt || new Date().toISOString(),
          },
        ],
      },
    ],
    summary: {
      totalCampaigns: 1,
      criticalAlerts: verdict === 'KILL' ? 1 : 0,
      totalAlerts: 1,
      estimatedImpact: impact,
    },
    timestamp: new Date().toISOString(),
  };
}

function normalizeVerdict(v: string): 'KILL' | 'SCALE' | 'HOLD' | 'OPTIMIZE' {
  const k = String(v || '').toUpperCase();
  if (['KILL', 'SCALE', 'HOLD', 'OPTIMIZE'].includes(k)) return k as any;
  if (k === 'REFRESH') return 'OPTIMIZE';
  return 'HOLD';
}

function getVerdictDefaults(v: string): { confidence: number; risk: string } {
  if (v === 'KILL') return { confidence: 90, risk: 'High' };
  if (v === 'SCALE') return { confidence: 80, risk: 'Low' };
  if (v === 'OPTIMIZE') return { confidence: 65, risk: 'Medium' };
  return { confidence: 60, risk: 'Medium' };
}

/**
 * Execute action via Meta API
 *
 * @param args - Action details
 * @returns Execution result
 * @throws Error if execution fails
 */
export async function executeAction(args: ExecuteActionArgs): Promise<ExecuteActionResult> {
  const { actionId, idempotencyKey, actionType, targetId, targetType, options } = args;

  try {
    const response = await api.post('/api/execute/meta', {
      actionType,
      targetId,
      targetType,
      idempotencyKey,
      options: options || {},
    });

    return {
      success: response.data.success,
      actionId,
      auditLogId: response.data.auditLogId,
      status: response.data.status,
      data: response.data.data,
      error: response.data.error,
    };
  } catch (error: any) {
    // Re-throw domain errors
    if (error.classification) {
      throw error;
    }

    // Wrap unknown errors
    throw new PlatformError({
      message: error.message || 'Action execution failed',
      code: 'EXECUTION_FAILED',
      fallbackAction: 'Retry or check audit log',
      cause: error,
    });
  }
}

/**
 * Poll execution status (fallback when SSE drops)
 *
 * @param args - Action ID to poll
 * @returns Current execution status
 * @throws Error if polling fails
 */
export async function pollExecutionStatus(args: PollExecutionStatusArgs): Promise<PollExecutionStatusResult> {
  const { actionId } = args;

  try {
    // Query audit log for latest status
    const response = await api.get('/api/execute/audit', {
      params: {
        actionType: undefined, // Get all
        status: undefined, // Get all
        limit: 50,
        offset: 0,
      },
    });

    // Find matching action by ID
    const logs = response.data.logs || [];
    const matchingLog = logs.find((log: any) => log.id === actionId);

    if (!matchingLog) {
      // Action not found yet (might still be queued)
      return {
        status: 'PENDING',
        actionId,
      };
    }

    // Map audit log status to FSM status
    const statusMap: Record<string, PollExecutionStatusResult['status']> = {
      SUCCESS: 'EXECUTED_SUCCESS',
      FAILED: 'EXECUTED_FAILED',
      PENDING: 'PENDING',
      QUEUED: 'QUEUED',
      EXECUTING: 'EXECUTING',
    };

    return {
      status: statusMap[matchingLog.status] || 'PENDING',
      actionId,
      error: matchingLog.errorMessage,
      data: matchingLog.response,
    };
  } catch (error: any) {
    // Re-throw domain errors
    if (error.classification) {
      throw error;
    }

    // Wrap unknown errors
    throw new PlatformError({
      message: error.message || 'Status polling failed',
      code: 'POLL_FAILED',
      fallbackAction: 'Retry or refresh page',
      cause: error,
    });
  }
}

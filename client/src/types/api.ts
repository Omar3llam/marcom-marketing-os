// ============================================================
// MARCOM v4.1 — API Types (Complete)
// ------------------------------------------------------------
// TypeScript definitions for ALL backend API routes.
// Based on: BACKEND-CONTRACTS.md § API Routes
//
// FROZEN: These types match backend API contracts.
// Do NOT modify without updating BACKEND-CONTRACTS.md first.
// ============================================================

import type { APIError } from './errors';

// ──────────────────────────────────────────────────────────
// 1. CAMPAIGNS (/api/campaigns)
// ──────────────────────────────────────────────────────────

/**
 * Campaign metric signal (threshold breach).
 */
export interface MetricSignal {
  metric: string;
  value: number;
  threshold: number;
  status: 'CRITICAL' | 'WARNING' | 'NORMAL';
}

/**
 * Source metrics from CSV/Meta.
 */
export interface SourceMetrics {
  spend: number;
  impressions: number;
  results: number;
  ctr: number;
  cpc: number;
  roas: number;
  frequency: number;
  reach: number;
  costPerResult: number;
}

/**
 * AI action plan.
 */
export interface ActionPlan {
  primaryAction: string;
  reasoning: string;
  steps: string[];
}

/**
 * Campaign decision from AI.
 */
export interface CampaignDecision {
  campaignId: string;
  campaignName: string;
  adsetName: string;
  verdict: string;
  rootCause: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  actionPlan: ActionPlan;
  signals: MetricSignal[];
  sourceMetrics: SourceMetrics;
}

/**
 * Campaign analyze-mode response shape. (The CSV upload endpoint was removed; the
 * same shape is returned by POST /api/campaigns/fetch-meta?mode=analyze.)
 */
export interface UploadCSVResponse {
  success: boolean;
  mode: 'analyze';
  decisions: CampaignDecision[];
  errors: string[];
  stats: {
    uploaded: number;
    analyzed: number;
    failed: number;
  };
}

/**
 * Campaign analyze-mode error (400).
 */
export interface UploadCSVError extends APIError {
  success: false;
  error: string;
  hint?: string;
}

/**
 * POST /api/campaigns/fetch-meta?mode=analyze request.
 */
export interface FetchMetaRequest {
  projectId: string;
  datePreset: 'last_7d' | 'last_14d' | 'last_30d';
}

/**
 * POST /api/campaigns/fetch-meta?mode=analyze response.
 * Same shape as UploadCSVResponse.
 */
export type FetchMetaResponse = UploadCSVResponse;

/**
 * POST /api/campaigns/fetch-meta error (404 — No credential).
 */
export interface FetchMetaErrorNoCredential {
  status: 'error';
  message: 'No Meta Ads credential found for this project. Connect Meta first.';
}

/**
 * POST /api/campaigns/fetch-meta error (401 — Token expired).
 */
export interface FetchMetaErrorTokenExpired {
  status: 'error';
  message: 'Meta access token expired. Please reconnect Meta Ads.';
}

// ──────────────────────────────────────────────────────────
// 2. LUMI FEED (/api/lumi)
// ──────────────────────────────────────────────────────────

/**
 * Metric trend direction.
 */
export type MetricTrend = 'up' | 'down' | 'flat';

/**
 * Metric status.
 */
export type MetricStatus = 'danger' | 'warning' | 'neutral' | 'positive';

/**
 * Campaign metric.
 */
export interface Metric {
  metric: string;
  trend: MetricTrend;
  value: string;
  delta: string;
  context: string;
  status: MetricStatus;
}

/**
 * Decision memory (historical insight).
 */
export interface DecisionMemory {
  actionType: string;
  decisionRationale: string;
  isSustainable: boolean | null;
  impactDurationHrs: number | null;
}

/**
 * Action plan status.
 */
export type ActionStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'EXECUTING'
  | 'EXECUTED_SUCCESS'
  | 'EXECUTED_FAILED';

/**
 * Alert action plan.
 */
export interface AlertActionPlan {
  action: string;
  status: ActionStatus;
  imageUrl: string | null;
  reference_prompt: string | null;
}

/**
 * Alert analysis.
 */
export interface AlertAnalysis {
  verdict: string;
  root_cause: string;
}

/**
 * Campaign alert.
 */
export interface Alert {
  action_id: string;
  idempotency_key: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  analysis: AlertAnalysis;
  historical_insight: string | null;
  action_plan: AlertActionPlan;
  metrics: Metric[];
  memory: DecisionMemory[];
  creative_assets: any | null;
}

/**
 * Campaign stage.
 */
export type CampaignStage = 'DYING' | 'FATIGUED' | 'TESTING' | 'SCALING' | 'STABLE';

/**
 * Campaign in feed.
 */
export interface Campaign {
  campaign_id: string;
  stage: CampaignStage;
  alerts: Alert[];
}

/**
 * GET /api/lumi/feed response.
 */
export interface LumiFeedResponse {
  workspaceId: string;
  generatedAt: string;
  campaigns: Campaign[];
}

/**
 * GET /api/lumi/demo-feed response.
 * Same shape as LumiFeedResponse.
 */
export type LumiDemoFeedResponse = LumiFeedResponse;

// ──────────────────────────────────────────────────────────
// 3. EXECUTION (/api/execute)
// ──────────────────────────────────────────────────────────

/**
 * Meta action types.
 */
export type MetaActionType =
  | 'PAUSE_CAMPAIGN'
  | 'RESUME_CAMPAIGN'
  | 'PAUSE_ADSET'
  | 'RESUME_ADSET'
  | 'SCALE_BUDGET'
  | 'REDUCE_BUDGET';

/**
 * Target type for action.
 */
export type TargetType = 'campaign' | 'adset' | 'ad';

/**
 * POST /api/execute/meta request.
 */
export interface ExecuteMetaRequest {
  actionType: MetaActionType;
  targetId: string;
  targetType: TargetType;
  idempotencyKey: string;
  options?: {
    amount?: number;
    [key: string]: any;
  };
}

/**
 * POST /api/execute/meta response (success).
 */
export interface ExecuteMetaResponse {
  success: true;
  idempotentReplay: boolean;
  executionId: string;
  auditLogId?: string;
  status: 'EXECUTED_SUCCESS';
  data: {
    meta_response?: any;
  };
  message: string;
}

/**
 * POST /api/execute/meta error (400 — Validation).
 */
export interface ExecuteMetaErrorValidation {
  success: false;
  error: string;
  code: 'VALIDATION_ERROR';
}

/**
 * POST /api/execute/meta error (400 — Execution failed).
 */
export interface ExecuteMetaErrorFailed {
  success: false;
  idempotentReplay: false;
  executionId: string;
  auditLogId: string;
  status: 'FAILED';
  error: string;
  code: 'META_API_ERROR';
  message: string;
}

/**
 * Audit log status.
 */
export type AuditStatus = 'SUCCESS' | 'FAILED' | 'PENDING';

/**
 * Audit log entry.
 */
export interface AuditLog {
  id: string;
  workspaceId: string;
  userId: string;
  actionType: MetaActionType;
  targetId: string;
  platform: 'META';
  status: AuditStatus;
  payload: any;
  response: any;
  errorMessage: string | null;
  performedAt: string;
}

/**
 * GET /api/execute/audit response.
 */
export interface GetAuditLogsResponse {
  logs: AuditLog[];
  total: number;
  limit: number;
  offset: number;
}

// ──────────────────────────────────────────────────────────
// 4. PROJECTS (/api/projects)
// ──────────────────────────────────────────────────────────

/**
 * Project metadata.
 */
export interface Project {
  projectId: string;
  name: string;
  updatedAt: string;
}

/**
 * GET /api/projects/list response.
 */
export type GetProjectsResponse = Project[];

/**
 * Project source type.
 */
export type ProjectSource = 'existing' | 'migrated' | 'created';

/**
 * GET /api/projects/mine response.
 */
export interface GetActiveProjectResponse {
  projectId: string;
  name: string;
  source: ProjectSource;
}

/**
 * POST /api/projects/create request.
 */
export interface CreateProjectRequest {
  projectId: string;
  name: string;
  context: string;
}

/**
 * POST /api/projects/create response.
 */
export interface CreateProjectResponse {
  ok: true;
  projectId: string;
}

/**
 * POST /api/projects/create error (409 — Duplicate).
 */
export interface CreateProjectErrorDuplicate {
  error: 'Project ID already exists. Please try again.';
}

/**
 * PATCH /api/projects/:projectId request.
 */
export interface UpdateProjectRequest {
  name?: string;
  context?: string;
}

/**
 * PATCH /api/projects/:projectId response.
 */
export interface UpdateProjectResponse {
  ok: true;
}

/**
 * DELETE /api/projects/:projectId response.
 */
export interface DeleteProjectResponse {
  ok: true;
}

/**
 * DELETE /api/projects/:projectId error (400 — Last project).
 */
export interface DeleteProjectErrorLastProject {
  error: 'Cannot delete your only project. Create another first.';
}

// ──────────────────────────────────────────────────────────
// 5. CREDENTIALS (/api/credentials)
// ──────────────────────────────────────────────────────────

/**
 * Platform type.
 */
export type Platform = 'meta_ads';

/**
 * GET /api/credentials/status response (connected).
 */
export interface CredentialStatusConnected {
  status: 'ok';
  connected: true;
  platform: Platform;
  accountId: string;
  expiresAt: string;
}

/**
 * GET /api/credentials/status response (not connected).
 */
export interface CredentialStatusNotConnected {
  status: 'ok';
  connected: false;
  platform: Platform;
  accountId: null;
  expiresAt: null;
}

/**
 * GET /api/credentials/status response.
 */
export type CredentialStatusResponse =
  | CredentialStatusConnected
  | CredentialStatusNotConnected;

/**
 * OAuth scopes.
 */
export type OAuthScope = 'ads_read' | 'ads_management';

/**
 * POST /api/credentials request.
 */
export interface SaveCredentialRequest {
  project_id: string;
  platform: Platform;
  access_token: string;
  refresh_token: string;
  account_id: string;
  scopes: OAuthScope[];
  expires_at: string;
}

/**
 * Credential metadata (no tokens).
 */
export interface CredentialMetadata {
  id: string;
  platform: Platform;
  accountId: string;
  scopes: OAuthScope[];
  expiresAt: string;
  createdAt: string;
}

/**
 * POST /api/credentials response.
 */
export interface SaveCredentialResponse {
  status: 'ok';
  credential: CredentialMetadata;
}

/**
 * DELETE /api/credentials/:projectId/:platform response.
 */
export interface DeleteCredentialResponse {
  status: 'ok';
}

// ──────────────────────────────────────────────────────────
// 6. HISTORY (/api/history)
// ──────────────────────────────────────────────────────────

/**
 * Chat session metadata.
 */
export interface ChatSessionMetadata {
  sessionId: string;
  title: string;
  updatedAt: string;
  projectId: string;
}

/**
 * GET /api/history/list response.
 */
export interface GetHistoryListResponse {
  sessions: ChatSessionMetadata[];
}

/**
 * Chat message.
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

/**
 * Chat session with messages.
 */
export interface ChatSession {
  sessionId: string;
  title: string;
  messages: ChatMessage[];
  projectId: string;
  updatedAt: string;
}

/**
 * GET /api/history/:sessionId response.
 */
export type GetChatSessionResponse = ChatSession;

/**
 * POST /api/history/save request.
 */
export interface SaveChatSessionRequest {
  sessionId: string;
  title: string;
  messages: ChatMessage[];
  projectId: string;
}

/**
 * POST /api/history/save response.
 */
export interface SaveChatSessionResponse {
  ok: true;
  sessionId: string;
  title: string;
  updatedAt: string;
}

/**
 * DELETE /api/history/:sessionId response.
 */
export interface DeleteChatSessionResponse {
  ok: true;
}

// ──────────────────────────────────────────────────────────
// 7. MEMORY (/api/memory)
// ──────────────────────────────────────────────────────────

/**
 * Result status for memory recording.
 */
export type ResultStatus = 'SUCCESS' | 'FAILED';

/**
 * POST /api/memory/record request.
 */
export interface RecordMemoryRequest {
  campaignId: string;
  actionType: string;
  decisionRationale: string;
  resultStatus: ResultStatus;
  deltaCtr: number;
  deltaRoas: number;
}

/**
 * POST /api/memory/record response.
 */
export interface RecordMemoryResponse {
  success: true;
  id: string;
}

/**
 * Memory pattern (aggregated learnings).
 */
export interface MemoryPattern {
  action: string;
  count: number;
  avgDeltaRoas: number;
  sustainableRate: number;
}

/**
 * Memory narrative (single decision).
 */
export interface MemoryNarrative {
  id: string;
  line: string;
  roas: number;
  recorded: string;
}

/**
 * GET /api/memory/patterns response.
 */
export interface GetMemoryPatternsResponse {
  patterns: MemoryPattern[];
  narratives: MemoryNarrative[];
  total: number;
}

// ──────────────────────────────────────────────────────────
// 8. ROLLBACK (/api/lumi/rollback)
// ──────────────────────────────────────────────────────────

/**
 * POST /api/lumi/rollback/:actionId response.
 */
export interface RollbackActionResponse {
  ok: true;
  rolledBackAction: string;
  inverseActionId: string;
  enqueued: true;
}

/**
 * POST /api/lumi/rollback/:actionId error (409 — Not rollbackable).
 */
export interface RollbackErrorNotRollbackable {
  error: 'NotRollbackable';
  reason: string;
}

/**
 * POST /api/lumi/rollback/:actionId error (410 — Window expired).
 */
export interface RollbackErrorWindowExpired {
  error: 'RollbackWindowExpired';
  reason: string;
}

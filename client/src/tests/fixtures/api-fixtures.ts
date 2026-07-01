// ============================================================
// MARCOM v4.1 — API Test Fixtures
// ------------------------------------------------------------
// Mock data for integration testing and component stories.
// Based on: BACKEND-CONTRACTS.md
//
// USAGE:
//   import { mockLumiFeed, mockCampaignDecision } from '@/tests/fixtures/api-fixtures';
//
//   // In tests
//   vi.mock('@/lib/api', () => ({
//     api: {
//       get: vi.fn().mockResolvedValue({ data: mockLumiFeed }),
//     },
//   }));
// ============================================================

import type {
  LumiFeedResponse,
  Campaign,
  Alert,
  CampaignDecision,
  ExecuteMetaResponse,
  GetAuditLogsResponse,
  GetMemoryPatternsResponse,
  ChatSession,
} from '@/types';

// ──────────────────────────────────────────────────────────
// LUMI FEED
// ──────────────────────────────────────────────────────────

export const mockAlert: Alert = {
  action_id: 'action-123',
  idempotency_key: 'meta:summer-sale:1684323456:abc123',
  priority: 'HIGH',
  analysis: {
    verdict: 'PAUSE_AND_RELAUNCH',
    root_cause: 'Creative fatigue + audience saturation',
  },
  historical_insight: 'Last 2 budget-scale actions regressed within 24h',
  action_plan: {
    action: 'Pause Broad Lookalike ad set immediately',
    status: 'PENDING',
    imageUrl: null,
    reference_prompt: 'UGC-style 9:16, natural lighting, product mid-frame',
  },
  metrics: [
    {
      metric: 'CTR',
      trend: 'down',
      value: '0.42%',
      delta: '-58% vs last week',
      context: 'Last 48h',
      status: 'danger',
    },
    {
      metric: 'ROAS',
      trend: 'down',
      value: '0.71x',
      delta: '-1.4x vs target',
      context: '7-day avg',
      status: 'danger',
    },
    {
      metric: 'Frequency',
      trend: 'up',
      value: '8.6',
      delta: '+186% vs optimal',
      context: '7-day avg',
      status: 'warning',
    },
  ],
  memory: [
    {
      actionType: 'meta.scale_budget',
      decisionRationale: 'Doubled budget after 3 days >3x ROAS',
      isSustainable: false,
      impactDurationHrs: 24,
    },
  ],
  creative_assets: null,
};

export const mockCampaign: Campaign = {
  campaign_id: 'Summer Promo — Broad Lookalike',
  stage: 'DYING',
  alerts: [mockAlert],
};

export const mockLumiFeed: LumiFeedResponse = {
  workspaceId: 'workspace-abc123',
  generatedAt: new Date().toISOString(),
  campaigns: [mockCampaign],
};

export const mockEmptyLumiFeed: LumiFeedResponse = {
  workspaceId: 'workspace-abc123',
  generatedAt: new Date().toISOString(),
  campaigns: [],
};

// ──────────────────────────────────────────────────────────
// CAMPAIGNS
// ──────────────────────────────────────────────────────────

export const mockCampaignDecision: CampaignDecision = {
  campaignId: 'summer-sale-broad-lookalike',
  campaignName: 'Summer Sale',
  adsetName: 'Broad Lookalike',
  verdict: 'PAUSE_AND_RELAUNCH',
  rootCause: 'Creative fatigue + audience saturation',
  confidence: 'HIGH',
  actionPlan: {
    primaryAction: 'Pause Broad Lookalike ad set',
    reasoning: 'CPA tripled, ROAS below break-even',
    steps: [
      'Pause ad set',
      'Refresh creative',
      'Re-launch with 1-3% LAL',
    ],
  },
  signals: [
    {
      metric: 'CTR',
      value: 0.42,
      threshold: 1.5,
      status: 'CRITICAL',
    },
    {
      metric: 'ROAS',
      value: 0.71,
      threshold: 2.0,
      status: 'CRITICAL',
    },
    {
      metric: 'Frequency',
      value: 8.6,
      threshold: 3.0,
      status: 'WARNING',
    },
  ],
  sourceMetrics: {
    spend: 12500,
    impressions: 45000,
    results: 320,
    ctr: 0.42,
    cpc: 39.06,
    roas: 0.71,
    frequency: 8.6,
    reach: 5232,
    costPerResult: 39.06,
  },
};

// ──────────────────────────────────────────────────────────
// EXECUTION
// ──────────────────────────────────────────────────────────

export const mockExecuteMetaResponse: ExecuteMetaResponse = {
  success: true,
  idempotentReplay: false,
  executionId: 'exec-abc123',
  auditLogId: 'audit-abc123',
  status: 'EXECUTED_SUCCESS',
  data: {
    meta_response: { success: true },
  },
  message: 'PAUSE_CAMPAIGN executed successfully on Meta',
};

export const mockAuditLogs: GetAuditLogsResponse = {
  logs: [
    {
      id: 'audit-123',
      workspaceId: 'workspace-abc123',
      userId: 'firebase-uid-123',
      actionType: 'PAUSE_CAMPAIGN',
      targetId: '123456789',
      platform: 'META',
      status: 'SUCCESS',
      payload: { actionType: 'PAUSE_CAMPAIGN', targetId: '123456789' },
      response: { success: true },
      errorMessage: null,
      performedAt: new Date().toISOString(),
    },
  ],
  total: 150,
  limit: 50,
  offset: 0,
};

// ──────────────────────────────────────────────────────────
// MEMORY
// ──────────────────────────────────────────────────────────

export const mockMemoryPatterns: GetMemoryPatternsResponse = {
  patterns: [
    {
      action: 'meta.scale_budget',
      count: 12,
      avgDeltaRoas: -0.85,
      sustainableRate: 25,
    },
    {
      action: 'meta.refresh_creative',
      count: 8,
      avgDeltaRoas: 1.2,
      sustainableRate: 75,
    },
  ],
  narratives: [
    {
      id: 'memory-123',
      line: 'meta.scale_budget on summer-sale — Doubled budget after 3 days >3x ROAS',
      roas: -1.2,
      recorded: new Date().toISOString(),
    },
  ],
  total: 50,
};

// ──────────────────────────────────────────────────────────
// HISTORY
// ──────────────────────────────────────────────────────────

export const mockChatSession: ChatSession = {
  sessionId: 'session-123',
  title: 'Summer Campaign Analysis',
  messages: [
    {
      role: 'user',
      content: 'Analyze this campaign',
      timestamp: new Date().toISOString(),
    },
    {
      role: 'assistant',
      content: 'Campaign shows creative fatigue...',
      timestamp: new Date().toISOString(),
    },
  ],
  projectId: 'proj_abc123',
  updatedAt: new Date().toISOString(),
};

// ──────────────────────────────────────────────────────────
// ERROR FIXTURES
// ──────────────────────────────────────────────────────────

export const mockAuthError = {
  error: 'Unauthenticated',
};

export const mockValidationError = {
  success: false,
  error: 'CSV has 25 rows. Maximum for analysis mode is 20.',
  hint: 'Split your export into smaller date ranges.',
};

export const mockMetaAPIError = {
  success: false,
  error: 'Meta API error: Insufficient permissions',
  code: 'META_API_ERROR',
};

export const mockCredentialNotFoundError = {
  status: 'error',
  message: 'No Meta Ads credential found for this project. Connect Meta first.',
};

export const mockTokenExpiredError = {
  status: 'error',
  message: 'Meta access token expired. Please reconnect Meta Ads.',
};

// ──────────────────────────────────────────────────────────
// SSE FIXTURES
// ──────────────────────────────────────────────────────────

export const mockSSEEvents = {
  connected: {
    type: 'CONNECTED' as const,
    timestamp: new Date().toISOString(),
  },
  queued: {
    type: 'EXECUTION_STATUS' as const,
    status: 'QUEUED' as const,
    targetId: '123456789',
    actionType: 'PAUSE_CAMPAIGN',
    timestamp: new Date().toISOString(),
  },
  executing: {
    type: 'EXECUTION_STATUS' as const,
    status: 'EXECUTING' as const,
    targetId: '123456789',
    actionType: 'PAUSE_CAMPAIGN',
    timestamp: new Date().toISOString(),
  },
  success: {
    type: 'EXECUTION_STATUS' as const,
    status: 'EXECUTED_SUCCESS' as const,
    targetId: '123456789',
    actionType: 'PAUSE_CAMPAIGN',
    auditLogId: 'audit-abc123',
    timestamp: new Date().toISOString(),
  },
  failed: {
    type: 'EXECUTION_STATUS' as const,
    status: 'EXECUTED_FAILED' as const,
    targetId: '123456789',
    actionType: 'PAUSE_CAMPAIGN',
    error: 'Insufficient permissions',
    timestamp: new Date().toISOString(),
  },
};

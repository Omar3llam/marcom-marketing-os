// ============================================================
// MARCOM v4.1 — Type Exports (Barrel)
// ------------------------------------------------------------
// Central export point for all TypeScript types.
//
// USAGE:
//   import type { LumiFeedResponse, FSMState, APIError } from '@/types';
// ============================================================

// API types
export type {
  // Campaigns
  MetricSignal,
  SourceMetrics,
  ActionPlan,
  CampaignDecision,
  FetchMetaRequest,
  FetchMetaResponse,
  FetchMetaErrorNoCredential,
  FetchMetaErrorTokenExpired,

  // Lumi Feed
  MetricTrend,
  MetricStatus,
  Metric,
  DecisionMemory,
  ActionStatus,
  AlertActionPlan,
  AlertAnalysis,
  Alert,
  CampaignStage,
  Campaign,
  LumiFeedResponse,
  LumiDemoFeedResponse,

  // Execution
  MetaActionType,
  TargetType,
  ExecuteMetaRequest,
  ExecuteMetaResponse,
  ExecuteMetaErrorValidation,
  ExecuteMetaErrorFailed,
  AuditStatus,
  AuditLog,
  GetAuditLogsResponse,

  // Projects
  Project,
  GetProjectsResponse,
  ProjectSource,
  GetActiveProjectResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  CreateProjectErrorDuplicate,
  UpdateProjectRequest,
  UpdateProjectResponse,
  DeleteProjectResponse,
  DeleteProjectErrorLastProject,

  // Credentials
  Platform,
  CredentialStatusConnected,
  CredentialStatusNotConnected,
  CredentialStatusResponse,
  OAuthScope,
  SaveCredentialRequest,
  CredentialMetadata,
  SaveCredentialResponse,
  DeleteCredentialResponse,

  // History
  ChatSessionMetadata,
  GetHistoryListResponse,
  ChatMessage,
  ChatSession,
  GetChatSessionResponse,
  SaveChatSessionRequest,
  SaveChatSessionResponse,
  DeleteChatSessionResponse,

  // Memory
  ResultStatus,
  RecordMemoryRequest,
  RecordMemoryResponse,
  MemoryPattern,
  MemoryNarrative,
  GetMemoryPatternsResponse,

  // Rollback
  RollbackActionResponse,
  RollbackErrorNotRollbackable,
  RollbackErrorWindowExpired,
} from './api';

// Auth types
export type {
  UserContext,
  Workspace,
  GetUserContextResponse,
  SaveUserContextRequest,
  SaveUserContextResponse,
  GetWorkspaceResponse,
  UpdateProfileRequest,
  UpdateProfileResponse,
  UpdateWorkspaceRequest,
  UpdateWorkspaceResponse,
  DeleteAccountResponse,
  AuthErrorResponse,
} from './auth';

// Error types
export type {
  ErrorClassification,
  APIError,
  ErrorCode,
  FSMErrorDetails,
  RequestState,
  RetryConfig,
} from './errors';

// FSM types
export type {
  FSMView,
  InputMode,
  ExecutionStatus,
  FSMState,
  FSMAction,
} from './fsm';

// SSE types
export type {
  SSETokenResponse,
  SSEExecutionStatus,
  SSEEvent,
  SSEConnectionState,
  SSEReconnectConfig,
} from './sse';

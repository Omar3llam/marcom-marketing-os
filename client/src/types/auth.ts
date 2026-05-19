// ============================================================
// MARCOM v4.1 — Authentication Types
// ------------------------------------------------------------
// TypeScript definitions for Firebase auth and workspace.
// Based on: BACKEND-CONTRACTS.md § Authentication Flow
//
// FROZEN: These types match backend auth contracts.
// Do NOT modify without updating BACKEND-CONTRACTS.md first.
// ============================================================

/**
 * User context (onboarding data).
 */
export interface UserContext {
  brandName: string;
  industry: string;
  objectives: string[];
}

/**
 * User workspace metadata.
 */
export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
}

/**
 * GET /api/campaigns/me/context response.
 */
export interface GetUserContextResponse {
  context: UserContext | null;
}

/**
 * PUT /api/campaigns/me/context request.
 */
export interface SaveUserContextRequest {
  context: UserContext;
  email: string;
  workspaceName: string;
}

/**
 * PUT /api/campaigns/me/context response.
 */
export interface SaveUserContextResponse {
  ok: boolean;
  user: {
    id: string;
    workspaceId: string;
    context: UserContext;
  };
  created: boolean;
}

/**
 * GET /api/user/workspace response.
 */
export interface GetWorkspaceResponse {
  workspace: Workspace | null;
  hasWorkspace: boolean;
}

/**
 * PATCH /api/user/profile request.
 */
export interface UpdateProfileRequest {
  displayName: string;
}

/**
 * PATCH /api/user/profile response.
 */
export interface UpdateProfileResponse {
  success: boolean;
  displayName: string;
}

/**
 * PATCH /api/user/workspace request.
 */
export interface UpdateWorkspaceRequest {
  workspaceName: string;
}

/**
 * PATCH /api/user/workspace response.
 */
export interface UpdateWorkspaceResponse {
  success: boolean;
  workspaceName: string;
}

/**
 * DELETE /api/user/account response.
 */
export interface DeleteAccountResponse {
  success: boolean;
}

/**
 * Auth error response (401).
 */
export interface AuthErrorResponse {
  error: 'Unauthenticated';
}

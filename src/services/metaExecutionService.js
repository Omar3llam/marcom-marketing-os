// ============================================================
// MARCOM / Lumi — Meta Execution Service
// ============================================================
// Orchestrates all interactions with Meta Ads API.
// CRITICAL: Retrieves tenant-specific tokens from database.
// No global .env tokens — every call is scoped to workspace.
//
// API Layer: Meta Marketing API on graph.facebook.com (v21.0, env-overridable) —
//   matches auth/meta.js, metaAdsService.js, TestTrackerService.js. (Previously
//   graph.instagram.com/v19.0 — the Instagram Graph host, which rejects
//   campaign/adset status + budget mutations.)
// Auth: workspace-scoped token from credentialStore (marcom_credentials) — the
//   OAuth-authoritative store. NOTE: the Integration Prisma model is write-dead
//   (nothing populates it), so this service used to read it and NEVER find a
//   token; re-pointed to resolveCredential, which also returns a DECRYPTED token
//   (the old path used Integration.accessToken raw despite it being "encrypted
//   at rest" — a latent second bug this fix also closes).
// Execution: Pause, Resume, Scale, Optimize campaigns/adsets
// ============================================================
import axios from 'axios';
import { logger } from '../utils/logger.js';
import { resolveCredential } from './connectors/credentialStore.js';

const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

// ── Action Type → Meta API Mapping ────────────────────────

const ACTION_ENDPOINTS = {
  PAUSE_CAMPAIGN: (id) => `/${id}?fields=status&status=PAUSED`,
  RESUME_CAMPAIGN: (id) => `/${id}?fields=status&status=ACTIVE`,
  PAUSE_ADSET: (id) => `/${id}?fields=status&status=PAUSED`,
  RESUME_ADSET: (id) => `/${id}?fields=status&status=ACTIVE`,
  INCREASE_BUDGET: (id, amount) => `/${id}?fields=daily_budget&daily_budget=${amount}`,
  DECREASE_BUDGET: (id, amount) => `/${id}?fields=daily_budget&daily_budget=${amount}`,
  SCALE_CAMPAIGN: (id, scale) => `/${id}?fields=daily_budget&daily_budget=${scale}`,
  OPTIMIZE_CAMPAIGN: (id, data) => `/${id}?${new URLSearchParams(data).toString()}`,
};

// ── Main Execution Function ──────────────────────────────

/**
 * Execute a Meta Ads action with full tenant context.
 *
 * @param {string} workspaceId - Tenant workspace ID (from req.user.workspaceId)
 * @param {string} userId - User ID for audit log
 * @param {string} actionType - e.g., 'PAUSE_CAMPAIGN', 'INCREASE_BUDGET'
 * @param {string} targetId - Campaign/AdSet ID from Meta
 * @param {object} options - Action-specific options (amount, scale, etc.)
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 * @throws {Error} If token not found, API fails, etc.
 */
export async function executeMetaAction(
  workspaceId,
  userId,
  actionType,
  targetId,
  options = {}
) {
  try {
    // ─────────────────────────────────────────────────────
    // Layer 1: Fetch tenant-specific Meta token
    // resolveCredential reads the OAuth-authoritative marcom_credentials store
    // (workspace-scoped, is_active = true only) and returns a DECRYPTED token.
    // ─────────────────────────────────────────────────────
    const cred = await resolveCredential(workspaceId, 'META');

    if (!cred) {
      throw new Error(`Meta credential not found for workspace ${workspaceId}`);
    }

    const token = cred.accessToken;
    if (!token) {
      throw new Error('Meta access token not available');
    }

    // ─────────────────────────────────────────────────────
    // Layer 2: Build request URL + payload
    // ─────────────────────────────────────────────────────
    const endpoint = buildEndpoint(actionType, targetId, options);
    const url = `${META_API_BASE}${endpoint}&access_token=${token}`;

    logger.info(`[MetaExecutionService] Executing ${actionType} on ${targetId}`, {
      workspaceId,
      userId,
      actionType,
      targetId,
    });

    // ─────────────────────────────────────────────────────
    // Layer 3: Execute HTTP request with timeout
    // ─────────────────────────────────────────────────────
    const response = await axios.post(url, {}, {
      timeout: 10000, // 10s timeout
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    logger.info(`[MetaExecutionService] Action succeeded`, {
      workspaceId,
      actionType,
      targetId,
      responseStatus: response.status,
    });

    return {
      success: true,
      data: response.data,
      platformStatus: response.status,
    };
  } catch (err) {
    const errorMessage = err.response?.data?.error?.message || err.message;

    logger.error({
      workspaceId,
      userId,
      actionType,
      targetId,
      error: errorMessage,
      statusCode: err.response?.status,
    }, `[MetaExecutionService] Action failed`);

    return {
      success: false,
      error: errorMessage,
      platformStatus: err.response?.status || 0,
      code: err.response?.data?.error?.code || 'UNKNOWN_ERROR',
    };
  }
}

// ── Endpoint Builder ─────────────────────────────────────

function buildEndpoint(actionType, targetId, options) {
  switch (actionType) {
    case 'PAUSE_CAMPAIGN':
    case 'RESUME_CAMPAIGN':
    case 'PAUSE_ADSET':
    case 'RESUME_ADSET': {
      const newStatus = actionType.includes('PAUSE') ? 'PAUSED' : 'ACTIVE';
      return `/${targetId}?status=${newStatus}`;
    }

    case 'INCREASE_BUDGET':
    case 'DECREASE_BUDGET':
    case 'SCALE_CAMPAIGN':
    case 'REALLOCATE_BUDGET': {
      // REALLOCATE moves budget; the cross-entity move is orchestrated by the
      // execution graph (reduce source, raise target). At the Meta API layer
      // this sets the resolved daily_budget on the target entity.
      const dailyBudget = options.dailyBudget || options.amount;
      if (!dailyBudget) throw new Error('dailyBudget required for budget actions');
      return `/${targetId}?daily_budget=${Math.round(dailyBudget)}`;
    }

    case 'REFRESH_CREATIVE': {
      const creativeId = options.creativeId || options.creative_id;
      if (!creativeId) throw new Error('creativeId required for REFRESH_CREATIVE');
      return `/${targetId}?creative[creative_id]=${creativeId}`;
    }

    case 'OPTIMIZE_CAMPAIGN': {
      const params = new URLSearchParams(options || {});
      return `/${targetId}?${params.toString()}`;
    }

    default:
      throw new Error(`Unknown action type: ${actionType}`);
  }
}

// ── Validation Helpers ───────────────────────────────────

/**
 * Validate that the action type matches the target type.
 * E.g., PAUSE_CAMPAIGN can only target campaigns, not adsets.
 */
export function validateActionTarget(actionType, targetType) {
  const VALID_TARGETS = {
    PAUSE_CAMPAIGN: ['campaign'],
    RESUME_CAMPAIGN: ['campaign'],
    SCALE_CAMPAIGN: ['campaign'],
    OPTIMIZE_CAMPAIGN: ['campaign'],
    INCREASE_BUDGET: ['campaign', 'adset'],
    DECREASE_BUDGET: ['campaign', 'adset'],
    PAUSE_ADSET: ['adset'],
    RESUME_ADSET: ['adset'],
    REALLOCATE_BUDGET: ['campaign', 'adset'],
    REFRESH_CREATIVE: ['adset', 'ad'],
  };

  const valid = VALID_TARGETS[actionType] || [];
  return valid.includes(targetType.toLowerCase());
}

/**
 * Check if Meta token for workspace is still valid.
 */
export async function checkIntegrationHealth(workspaceId) {
  try {
    // resolveCredential already filters is_active = true → null means "no active
    // Meta credential" (covers both not-found and disabled).
    const cred = await resolveCredential(workspaceId, 'META');

    if (!cred || !cred.accessToken) return { healthy: false, reason: 'No active Meta credential found' };
    if (cred.expiresAt && new Date() > new Date(cred.expiresAt)) {
      return { healthy: false, reason: 'Token expired' };
    }

    return { healthy: true };
  } catch (err) {
    logger.error('[MetaExecutionService] Health check failed', { workspaceId, error: err.message });
    return { healthy: false, reason: err.message };
  }
}

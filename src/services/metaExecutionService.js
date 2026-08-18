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
import { isValidTargetId, validateOptions, ALLOWED_OPTION_KEYS } from './meta/mutationParams.js';

const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

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
    //
    // R11 (I68) — the token is an Authorization header, never a query
    // parameter. It used to be appended as `&access_token=${token}`, and
    // without encodeURIComponent at that: a 60-day workspace credential landed
    // in every access log, proxy log and APM span that recorded the outbound
    // URL. Google's flow in this same codebase already did it correctly, so the
    // pattern was known and applied inconsistently.
    // ─────────────────────────────────────────────────────
    const { path, params } = buildRequest(actionType, targetId, options);
    const url = `${META_API_BASE}${path}`;

    logger.info(`[MetaExecutionService] Executing ${actionType} on ${targetId}`, {
      workspaceId,
      userId,
      actionType,
      targetId,
    });

    // ─────────────────────────────────────────────────────
    // Layer 3: Execute HTTP request with timeout
    // ─────────────────────────────────────────────────────
    // Mutation fields travel in the form-encoded BODY, not the query string —
    // same reasoning as the token: URLs are logged, bodies are not.
    const response = await axios.post(url, new URLSearchParams(params).toString(), {
      timeout: 10000, // 10s timeout
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${token}`,
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

/**
 * R11 (I67/I68) — build the Graph API request as a validated PATH plus a
 * separate PARAMS object.
 *
 * Previously this returned a single interpolated string. `targetId` was checked
 * only as "a non-empty string" upstream, so a value containing `/`, `?` or `&`
 * controlled the path AND the query of an authenticated POST made with the
 * workspace's own Meta token. OPTIMIZE_CAMPAIGN went further and passed the
 * caller's whole options object through `new URLSearchParams`, which is not an
 * optimisation endpoint — it is a generic Graph API proxy with someone else's
 * credentials attached.
 *
 * Now: the id is format-checked here as well as at the route (a service that
 * issues authenticated mutations does not delegate its own preconditions), and
 * fields are returned as data rather than concatenated into a URL.
 *
 * @returns {{ path: string, params: Record<string, string|number> }}
 */
export function buildRequest(actionType, targetId, options = {}) {
  // Re-checked here, not just at the route: this is the last point before a
  // real credential is attached, and the worker is a separate entry path.
  if (!isValidTargetId(targetId)) {
    throw new Error('targetId must be a Meta object id (digits, optionally prefixed with act_)');
  }

  const path = `/${targetId}`;

  switch (actionType) {
    case 'PAUSE_CAMPAIGN':
    case 'RESUME_CAMPAIGN':
    case 'PAUSE_ADSET':
    case 'RESUME_ADSET': {
      const newStatus = actionType.includes('PAUSE') ? 'PAUSED' : 'ACTIVE';
      return { path, params: { status: newStatus } };
    }

    case 'INCREASE_BUDGET':
    case 'DECREASE_BUDGET':
    case 'SCALE_CAMPAIGN':
    case 'REALLOCATE_BUDGET': {
      // REALLOCATE moves budget; the cross-entity move is orchestrated by the
      // execution graph (reduce source, raise target). At the Meta API layer
      // this sets the resolved daily_budget on the target entity.
      const dailyBudget = Number(options.dailyBudget ?? options.amount);
      if (!Number.isFinite(dailyBudget) || dailyBudget <= 0) {
        throw new Error('dailyBudget required for budget actions and must be a positive number');
      }
      return { path, params: { daily_budget: Math.round(dailyBudget) } };
    }

    case 'REFRESH_CREATIVE': {
      const creativeId = options.creativeId ?? options.creative_id;
      if (!isValidTargetId(String(creativeId ?? ''))) {
        throw new Error('creativeId required for REFRESH_CREATIVE and must be a Meta object id');
      }
      return { path, params: { 'creative[creative_id]': String(creativeId) } };
    }

    case 'OPTIMIZE_CAMPAIGN': {
      // The allowlist is the contract. Anything outside it is refused here
      // rather than forwarded to Meta with the workspace's credential.
      const invalid = validateOptions('OPTIMIZE_CAMPAIGN', options);
      if (invalid) throw new Error(invalid);

      const params = {};
      for (const key of ALLOWED_OPTION_KEYS.OPTIMIZE_CAMPAIGN) {
        if (options[key] !== undefined) params[key] = options[key];
      }
      if (Object.keys(params).length === 0) {
        throw new Error(`OPTIMIZE_CAMPAIGN requires at least one of: ${ALLOWED_OPTION_KEYS.OPTIMIZE_CAMPAIGN.join(', ')}`);
      }
      return { path, params };
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

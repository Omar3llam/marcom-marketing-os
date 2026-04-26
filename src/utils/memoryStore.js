// ============================================================
// MARCOM — Anthropic Memory Store Utility
// Uses @anthropic-ai/sdk >= 0.91.0 native beta.memoryStores API.
//
// SETUP REQUIRED:
//   1. Run:  npm run create-memory
//   2. Add to .env AND to Render environment variables:
//        ANTHROPIC_MEMORY_STORE_ID=<id>
//
// GRACEFUL DEGRADATION:
//   All exports are safe to call when ANTHROPIC_MEMORY_STORE_ID is
//   absent — they resolve immediately with null / no-op so the rest
//   of the pipeline is unaffected.
//
// BETA HEADER NOTE:
//   memories.create / memories.list do NOT accept `betas` in the
//   request body the way memoryStores.create does. The beta header
//   must be passed via SDK request options:
//     { headers: { 'anthropic-beta': BETA_HEADER } }
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import { logger } from './logger.js';

const BETA_HEADER   = 'managed-agents-2026-04-01';
const REQUEST_OPTS  = { headers: { 'anthropic-beta': BETA_HEADER } };

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

function isConfigured() {
  const ok = !!(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_MEMORY_STORE_ID);
  if (!ok) {
    // Log once per process start so misconfiguration is visible in Render logs.
    if (!isConfigured._warned) {
      isConfigured._warned = true;
      logger.warn(
        'Memory Store disabled — ANTHROPIC_MEMORY_STORE_ID not set. ' +
        'Add it to Render environment variables to enable persistent memory.'
      );
    }
  }
  return ok;
}

// ── fetchMemories ────────────────────────────────────────────
/**
 * Retrieve relevant memories for a user.
 *
 * @param {string} userId  — Clerk user ID (used as the memory namespace)
 * @param {string} [query] — Natural-language query to surface relevant memories
 * @returns {Promise<string|null>}
 */
export async function fetchMemories(userId, query = '') {
  if (!isConfigured()) return null;

  const storeId = process.env.ANTHROPIC_MEMORY_STORE_ID;

  try {
    const queryParams = query ? { query: query.slice(0, 500) } : {};

    // Beta header passed via request options — NOT in the body.
    const page = await getClient().beta.memoryStores.memories.list(
      storeId,
      queryParams,
      REQUEST_OPTS,
    );
    const memories = page.data ?? [];

    // Filter to this user's memories only (multi-tenant safety).
    const userMemories = memories.filter(m =>
      !m.metadata?.user_id || m.metadata.user_id === userId
    );

    if (!userMemories.length) return null;

    const lines = userMemories.slice(0, 10).map((m, i) => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `  ${i + 1}. ${content}`;
    });

    return [
      '### LUMI MEMORY — KNOWN FACTS ABOUT THIS USER',
      '(Recalled from previous sessions. Use naturally — do not announce you are reading memory.)',
      ...lines,
    ].join('\n');

  } catch (err) {
    logger.warn({ err: err.message, userId }, '[memoryStore] fetchMemories failed — continuing without memories');
    return null;
  }
}

// ── writeMemory ──────────────────────────────────────────────
/**
 * Fire-and-forget: persist a new memory fact for the user.
 * Tagged with userId and optional projectId for multi-tenant isolation.
 *
 * @param {string} userId    — Clerk user ID
 * @param {string} content   — The fact to store (free-form string, ≤ 500 chars)
 * @param {string} [projectId] — Active project ID for namespacing
 * @returns {Promise<void>}
 */
export async function writeMemory(userId, content, projectId = null) {
  if (!isConfigured()) return;
  if (!content || !content.trim()) return;

  const storeId = process.env.ANTHROPIC_MEMORY_STORE_ID;
  const trimmed = content.trim().slice(0, 500);

  try {
    // Beta header passed via request options — NOT in the body.
    const result = await getClient().beta.memoryStores.memories.create(
      storeId,
      {
        content:  trimmed,
        metadata: {
          user_id:    userId,
          project_id: projectId || 'global',
          stored_at:  new Date().toISOString(),
        },
      },
      REQUEST_OPTS,
    );
    logger.info(
      { userId, projectId, memoryId: result?.id },
      '[memoryStore] Memory written successfully'
    );
  } catch (err) {
    // Silent fail — never block or crash the chat pipeline.
    logger.error(
      { err: err.message, status: err.status, userId, projectId },
      '[memoryStore] writeMemory failed — fact NOT persisted'
    );
  }
}

// ── extractMemoryFact ────────────────────────────────────────
/**
 * Extract a persistable fact from a completed conversation turn.
 * Catches both explicit brand declarations AND any substantive user
 * message (≥ 30 chars) that references the user's business context.
 * Returns null when nothing worth storing is detected.
 *
 * @param {string} aiResponse  — The assistant's response (used for context)
 * @param {string} userMessage — The user's message
 * @returns {string|null}
 */
export function extractMemoryFact(aiResponse, userMessage) {
  if (!userMessage || userMessage.length < 10) return null;

  // Tier 1 — explicit brand/business declaration
  const tier1 = [
    /\bmy\s+(brand|business|company|product|service|goal|audience|target|store|shop|agency)\b/i,
    /\bi\s+(sell|offer|make|run|manage|own|work|speciali[sz]e)\b/i,
    /\bwe\s+(sell|offer|make|run|manage|own|produce|speciali[sz]e)\b/i,
    /\bour\s+(brand|business|company|product|service|audience|clients?|customers?)\b/i,
    /\b(i am|i'm|we are|we're)\s+(a|an|the)\s+\w+/i,
  ];

  // Tier 2 — contextual signals worth remembering
  const tier2 = [
    /\b(industry|niche|market|sector)\b/i,
    /\b(budget|revenue|sales|conversion|ROI|ROAS|CPA|CPM)\b/i,
    /\b(facebook|instagram|tiktok|google|email|seo|paid\s+ads)\b/i,
    /\b(target\s+audience|ideal\s+customer|buyer\s+persona)\b/i,
    /\b(launch|campaign|strategy|funnel)\b/i,
  ];

  const matchesTier1 = tier1.some(re => re.test(userMessage));
  const matchesTier2 = tier2.some(re => re.test(userMessage));

  // Store if tier1 matches, OR if tier2 matches AND message is substantive
  if (!matchesTier1 && !(matchesTier2 && userMessage.length >= 30)) return null;

  const label = matchesTier1 ? 'Brand/business fact' : 'Marketing context';
  return `[${label}] "${userMessage.trim().slice(0, 300)}"`;
}

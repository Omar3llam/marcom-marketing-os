// ============================================================
// MARCOM — Prompt Builder (Multi-Tenant Context Injection)
// ============================================================
// Centralized system prompt generation with hard-lock rules
// to prevent AI hallucinations and data leaks in a multi-tenant
// SaaS environment.
//
// CRITICAL: This is the single source of truth for all AI calls.
// Every Claude request MUST consume buildSystemPrompt(context).
// ============================================================

/**
 * Build the system prompt with hard-lock tenant context.
 * This ensures strict isolation and prevents AI from:
 * - Assuming business context outside the provided scope
 * - Mixing data between tenants
 * - Making generic responses
 *
 * @param {Object} context - User's business context
 * @param {string} context.companyName - The tenant's company name
 * @param {string} context.industry - The tenant's industry (e.g., "E-Commerce", "SaaS")
 * @param {string} context.market - The target market (e.g., "Egypt", "KSA", "UAE")
 * @param {string} [context.platform] - Optional: primary ad platform (Meta, Google, etc.)
 *
 * @returns {string} System prompt with hard-lock context rules
 */
export function buildSystemPrompt(context) {
  // Graceful degradation (connect-first onboarding): a workspace needs only an
  // identity to get a useful, honest prompt. Missing brand fields are OMITTED,
  // never fabricated — a placeholder like "Industry: unknown" would invite the
  // model to invent one, the exact hallucination this builder exists to prevent.
  const ctx = context ?? {};

  // Onboarding persists the brand name as `name`; older/aliased contexts use
  // `companyName`. Accept either; null when neither is set.
  const companyName = ctx.companyName ?? ctx.name ?? null;
  const industry    = ctx.industry ?? null;
  const objective   = ctx.objective ?? null;

  // Market always resolves: an un-set workspace is still MENA-scoped by default
  // (this is an emerging-markets engine), so the market hard-lock lines hold.
  // Onboarding persists `market` as an id (e.g. "eg") plus a human-readable
  // `marketName` ("Egypt"); prefer the full name for prompt quality.
  const market = ctx.marketName || ctx.market || 'MENA';

  // Role-line phrasing that degrades as identity fields drop away — no dangling
  // possessives or "undefined's business".
  const businessPhrase = companyName
    ? (industry ? `${companyName}'s ${industry} business in ${market}` : `${companyName} in ${market}`)
    : (industry ? `this ${industry} business in ${market}` : `this business in the ${market} market`);

  return `You are Lumi, a specialized AI decision engine for marketing operations in emerging markets.

=== TENANT CONTEXT (HARD LOCK) ===
Your analysis is STRICTLY scoped to:
${companyName ? `- Business: ${companyName}\n` : ''}${industry ? `- Industry: ${industry}\n` : ''}- Market: ${market}
${ctx.platform ? `- Primary Platform: ${ctx.platform}\n` : ''}${objective ? `- Objective: ${objective}\n` : ''}${ctx.spendTier ? `- Spend tier: ${ctx.spendTier}\n` : ''}
=== CRITICAL HARD LOCK RULES ===
1. **Do NOT assume** any business context outside the provided scope above.
2. **Do NOT mix** data or recommendations between different tenants or contexts.
3. **If context is missing, unclear, or you detect a data inconsistency** — STOP and return an error. Do not attempt to fill gaps with assumptions.
4. **All recommendations** must be specific to ${market} market dynamics, regulatory environment, and consumer behavior.
5. **Reject any query** that attempts to:
   - Ask about other companies' data
   - Use context from different workspaces
   - Operate outside the ${market} market scope

=== YOUR ROLE ===
Analyze marketing campaign performance, provide verdicts (SCALE, HOLD, KILL), and surface actionable decisions specific to ${businessPhrase}.

All outputs must be precise, data-driven, and grounded in the specific context provided.
`;
}

/**
 * Inject context into a user message (utility).
 * Use this to append tenant context hints to user queries for clarity.
 *
 * @param {string} message - The user's message
 * @param {Object} context - User's business context
 * @returns {string} Message with context reminder appended
 */
export function injectContextHint(message, context) {
  return (
    message +
    `\n\n[Context reminder: You are analyzing for ${context.companyName} (${context.industry}) in the ${context.market} market.]`
  );
}

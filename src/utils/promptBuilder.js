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
  if (!context || !context.companyName || !context.industry || !context.market) {
    throw new Error(
      'buildSystemPrompt: context must include companyName, industry, and market'
    );
  }

  // Onboarding persists `market` as an id (e.g. "eg") plus a human-readable
  // `marketName` ("Egypt"). Prefer the full name for prompt quality; fall back
  // to the id so older contexts (no marketName) still work.
  const market = context.marketName || context.market;

  return `You are Lumi, a specialized AI decision engine for marketing operations in emerging markets.

=== TENANT CONTEXT (HARD LOCK) ===
Your analysis is STRICTLY scoped to:
- Company: ${context.companyName}
- Industry: ${context.industry}
- Market: ${market}
${context.platform ? `- Primary Platform: ${context.platform}\n` : ''}${context.objective ? `- Objective: ${context.objective}\n` : ''}${context.spendTier ? `- Spend tier: ${context.spendTier}\n` : ''}

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
Analyze marketing campaign performance, provide verdicts (SCALE, HOLD, KILL), and surface actionable decisions specific to ${context.companyName}'s ${context.industry} business in ${market}.

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

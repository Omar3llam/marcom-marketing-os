import { prisma }  from '../../lib/prisma.js';
import { logger }  from '../../utils/logger.js';
import { currencyForMarket } from '../../lib/currencyDetector.js';

// Onboarding market ids → full names. Mirrors MARKETS in
// client/src/pages/OnboardingPage/constants.js (kept in sync by hand — six
// fixed markets, not a hot path). Used only to populate `marketName` below.
const MARKET_NAMES = {
  eg: 'Egypt', sa: 'Saudi Arabia', ae: 'UAE', kw: 'Kuwait', jo: 'Jordan', ma: 'Morocco',
};

// The onboarding wizard stores its form verbatim (name, market id, industry, …).
// Two downstream consumers — contextGuard and buildSystemPrompt — were written
// against a different shape: companyName + industry + a full market name. Persist
// BOTH. The onboarding-native fields are left untouched (isOnboarded, ReviewStep
// and the dual-agent context blob keep reading them unchanged) and the
// consumer-expected aliases are added on top, so those guards resolve to real
// data instead of 400ing if their routes are ever wired into the live frontend.
// Additive, never a rename. Exported for unit testing.
export function withContextAliases(ctx) {
  if (!ctx || typeof ctx !== 'object') return ctx;
  return {
    ...ctx,
    companyName: ctx.companyName ?? ctx.name,            // contextGuard / promptBuilder / isOnboarded
    marketName:  ctx.marketName ?? MARKET_NAMES[ctx.market] ?? ctx.market, // prompt-quality full name
    // `industry` rides through ...ctx verbatim from the IndustryStep — no alias needed.
  };
}

// Project the onboarding blob onto the real Workspace columns (schema:
// spendTier/objective/adChannels). These are workspace-scoped so a
// workspace-scoped service (AgenticLoop, /api/user/workspace) can read them
// instead of digging into a per-user JSON blob. The wizard stores channels as
// an { meta:true, google:false } map keyed by lowercase id; the column stores
// the normalized uppercase Channel values (META/GOOGLE) so they line up with
// Campaign.channel. Every field tolerates absence (skipped step → null / []).
//
// NOTE on adChannels: this is a STORED PREFERENCE only — no service or client
// reads it (audit 2026-07). The real channel scope is driven by OAuth/Integration
// rows (a connected account), never this list. Promoted for completeness; do not
// add a consumer that FILTERS campaigns by it (that would hide real campaigns).
// Exported for unit testing.
export function workspaceColumnsFromContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return { spendTier: null, objective: null, adChannels: [] };
  const channelMap = ctx.channels && typeof ctx.channels === 'object' ? ctx.channels : {};
  const adChannels = Object.keys(channelMap)
    .filter((k) => channelMap[k])
    .map((k) => String(k).toUpperCase());
  // When the goal is 'custom', promote the user's own words into the column so
  // prompt consumers (copilot, portfolio briefing, reasoning) read the real
  // objective instead of the opaque literal 'custom'. Empty / whitespace-only
  // custom text falls back to 'custom' — never store an empty string.
  const objective = ctx.objective === 'custom'
    ? (ctx.customObjective?.trim() || 'custom')
    : (ctx.objective ?? null);
  return {
    spendTier:  ctx.spendTier ?? null,
    objective,
    adChannels,
  };
}

// Fields collected in onboarding but NOT consumed downstream (audit 2026-07).
// The full form is persisted verbatim in User.context; these two ride along but
// have no reader — kept for data completeness, not wired to anything:
//   - city: shown in the onboarding ReviewStep only. The dialect system derives
//           city from the message TEXT (dialectContext.js), never from this field.
//   - tag:  legacy field. No onboarding step sets it; nothing reads it.
// Do not add consumers for these without a clear, deliberate use case.
export function mountContextRoutes(router) {
  router.get('/me/context', async (req, res) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
    try {
      // R11 (I57): the Firebase uid is the sole identity key. This read used to
      // carry `OR: [{ clerkId }, { email }]`, which returned another account's
      // onboarding context to anyone who could register its email address.
      const user = await prisma.user.findUnique({
        where:  { clerkId: userId },
        select: { context: true },
      });
      return res.json({ context: user?.context ?? null });
    } catch (err) {
      // R11 (I71): a read failure is not "this user has not onboarded". The old
      // `.catch(() => null)` + `res.json({ context: null })` reported a DB
      // outage as a fresh account and bounced the user back into onboarding.
      logger.error({ err: err.message, userId }, '[campaigns/me/context] read failed');
      return res.status(503).json({
        error:   'ContextUnavailable',
        message: 'Could not load your account context right now.',
      });
    }
  });

  router.put('/me/context', async (req, res) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
    const ctx = req.body?.context;
    if (!ctx || typeof ctx !== 'object') return res.status(400).json({ error: 'context object required in body' });

    // R11 (I57/I59): the email is a CONTACT attribute taken from the verified
    // token only. The old `|| req.body?.email` made a request-body field
    // participate in identity resolution, which is exactly what turned this
    // route into the account-takeover door.
    const email         = req.user?.email || `${userId}@unknown.local`;
    const workspaceName = req.body?.workspaceName || 'My Workspace';
    const context       = withContextAliases(ctx);
    const wsPrefs       = workspaceColumnsFromContext(context);
    // The display currency new accounts START with, derived from the onboarding
    // market (EG→EGP, SA→SAR, …). 'USD' when the market is missing/unknown. The
    // authoritative currency (Meta account / CSV header) overrides this later.
    const marketCurrency = currencyForMarket(context.market);

    try {
      // R11 (I57): resolve by Firebase uid ONLY.
      //
      // This lookup used to be `OR: [{ clerkId: userId }, { email }]`, and the
      // update below then wrote `clerkId: userId` onto whatever row it found.
      // Together they let any authenticated caller claim an existing account by
      // registering its email address: the row was found by email, its clerkId
      // was rewritten to the caller's uid, and from the next request onwards the
      // caller WAS that workspace — every workspace-scoped WHERE in the system
      // resolved in their favour, including the connected Meta credentials.
      // There is no compatibility case that needs the email arm; it was the bug.
      let existing = await prisma.user.findUnique({
        where:  { clerkId: userId },
        select: { id: true, workspaceId: true, clerkId: true, email: true },
      });

      if (!existing) {
        const created = await prisma.user.create({
          data: { clerkId: userId, email, context, workspace: { create: { name: workspaceName, currency: marketCurrency, ...wsPrefs } } },
          select: { id: true, workspaceId: true, context: true },
        });
        logger.info({ firebaseUid: userId, userRowId: created.id, workspaceId: created.workspaceId }, '[campaigns/me/context] created new user + workspace (Firebase)');
        return res.json({ ok: true, user: created, created: true });
      }

      let workspaceId = existing.workspaceId;
      if (!workspaceId) {
        const ws = await prisma.workspace.create({ data: { name: workspaceName, currency: marketCurrency, ...wsPrefs } });
        workspaceId = ws.id;
        await prisma.user.update({ where: { id: existing.id }, data: { workspaceId } });
        logger.warn({ userId, repairedWorkspaceId: workspaceId }, '[campaigns/me/context] repaired orphaned user (no workspace)');
      }

      // R11 (I57): write the context only. `clerkId` is the identity key and is
      // never reassigned by a handler — the row was found BY it, so writing it
      // back was either a no-op or an adoption, and adoption was the takeover.
      const updated = await prisma.user.update({
        where:  { id: existing.id },
        data:   { context },
        select: { id: true, workspaceId: true, context: true },
      });

      // Keep the workspace's onboarding-preference columns in sync with the
      // latest context (re-onboarding updates them). Separate from the currency
      // guard below because these always reflect the newest answers.
      if (updated.workspaceId) {
        await prisma.workspace.update({ where: { id: updated.workspaceId }, data: wsPrefs });
      }

      // The common path: firebaseAuth auto-provisioned this workspace at first
      // request (default USD) BEFORE onboarding ran. Seed its display currency
      // from the market — but ONLY while it's still the default USD, so a real
      // currency already detected from Meta/CSV is never clobbered. updateMany's
      // WHERE makes this atomic + idempotent.
      if (marketCurrency !== 'USD' && updated.workspaceId) {
        await prisma.workspace.updateMany({
          where: { id: updated.workspaceId, currency: 'USD' },
          data:  { currency: marketCurrency },
        });
      }

      logger.info({ firebaseUid: userId, userRowId: updated.id }, '[campaigns/me/context] updated existing user (Firebase)');
      return res.json({ ok: true, user: updated, created: false });
    } catch (err) {
      const detail = { name: err?.name, code: err?.code, meta: err?.meta, message: err?.message, userId: req.userId, workspaceId: req.workspaceId };
      logger.error(detail, '[campaigns/me/context] Prisma write failed — check schema migrations');
      return res.status(500).json({
        error:  'Could not save context',
        code:   err?.code ?? null,
        // Raw err.message is an internal-detail leak in production; the full
        // detail object is already in the logger.error line above.
        detail: process.env.NODE_ENV === 'development' ? (err?.message ?? 'Unknown error') : undefined,
        hint:   err?.code === 'P2021' || /does not exist/i.test(err?.message || '') ? 'The User table or context column is missing. Run: npx prisma migrate deploy' : null,
      });
    }
  });
}

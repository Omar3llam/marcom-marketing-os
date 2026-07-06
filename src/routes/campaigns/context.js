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
// Exported for unit testing.
export function workspaceColumnsFromContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return { spendTier: null, objective: null, adChannels: [] };
  const channelMap = ctx.channels && typeof ctx.channels === 'object' ? ctx.channels : {};
  const adChannels = Object.keys(channelMap)
    .filter((k) => channelMap[k])
    .map((k) => String(k).toUpperCase());
  return {
    spendTier:  ctx.spendTier ?? null,
    objective:  ctx.objective ?? null,
    adChannels,
  };
}

export function mountContextRoutes(router) {
  router.get('/me/context', async (req, res) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
    try {
      const email = req.user?.email;
      const user = await prisma.user.findFirst({
        where: { OR: [{ clerkId: userId }, ...(email ? [{ email }] : [])] },
        select: { context: true },
      }).catch(() => null);
      return res.json({ context: user?.context ?? null });
    } catch (err) {
      logger.warn({ err: err.message }, '[campaigns/me/context] read failed');
      return res.json({ context: null });
    }
  });

  router.put('/me/context', async (req, res) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
    const ctx = req.body?.context;
    if (!ctx || typeof ctx !== 'object') return res.status(400).json({ error: 'context object required in body' });

    const email         = req.user?.email || req.body?.email || `${userId}@unknown.local`;
    const workspaceName = req.body?.workspaceName || 'My Workspace';
    const context       = withContextAliases(ctx);
    const wsPrefs       = workspaceColumnsFromContext(context);
    // The display currency new accounts START with, derived from the onboarding
    // market (EG→EGP, SA→SAR, …). 'USD' when the market is missing/unknown. The
    // authoritative currency (Meta account / CSV header) overrides this later.
    const marketCurrency = currencyForMarket(context.market);

    try {
      let existing = await prisma.user.findFirst({
        where:  { OR: [{ clerkId: userId }, { email }] },
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

      const updated = await prisma.user.update({
        where:  { id: existing.id },
        data:   { context, clerkId: userId, email },
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

      logger.info({ firebaseUid: userId, userRowId: updated.id, wasUidMissing: !existing.clerkId }, '[campaigns/me/context] updated existing user (Firebase)');
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

// ============================================================
// MARCOM / Admin — AI usage & estimated cost
//   GET /api/admin/ai-usage?days=30
//
// ADMIN-only (gated at the mount). Cross-workspace by design.
//
// EVERY figure here is an ESTIMATE derived from our own token counts against a
// hardcoded, dated pricing table. The provider invoices are the truth. Three
// design rules follow from that, and they are the reason this file is longer
// than a sum of columns:
//
//   1. Cost is priced per MODEL, not per provider. gpt-4o and gpt-4o-mini
//      differ 16x; Sonnet and Opus differ 5x. A per-provider flat rate would
//      publish a confidently wrong number.
//   2. An unpriced or unmetered call costs `null`, never 0. "We don't know"
//      and "it was free" must not render identically.
//   3. Prisma's _sum SKIPS nulls, so a sum over partially-metered rows is a
//      PARTIAL total. Every cost is therefore reported alongside how many
//      calls it actually covers.
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { parseLimit } from './pagination.js';
import { costFromTokens, PRICING_AS_OF } from '../../services/ai-gateway/providerCosts.js';

export const aiUsageRouter = Router();

const DEFAULT_DAYS = 30;
// Capped at the retention window — asking for 180 days would silently return
// 90 days of data and label it 180.
const MAX_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_WORKSPACE_ROWS = 20;

const DISCLAIMER =
  `Estimated from our own token counts against hardcoded ${PRICING_AS_OF} pricing. ` +
  'Provider invoices are the source of truth — verify against them before billing anyone.';

/** Fold model-level groups into one provider row, keeping the cost honest. */
function foldProvider(provider, rows) {
  let calls = 0;
  let meteredCalls = 0;
  let inputTokens = null;
  let outputTokens = null;
  let tokens = null;
  let cost = null;
  let pricedCalls = 0;

  const add = (a, b) => (b == null ? a : (a ?? 0) + b);

  const models = rows.map((r) => {
    const rowCost = costFromTokens(provider, r.model, r._sum.inputTokens, r._sum.outputTokens);

    calls += r._count._all;
    // _count on a nullable FIELD counts non-null values — this is how many of
    // the calls actually reported a token split.
    meteredCalls += r._count.inputTokens;
    inputTokens = add(inputTokens, r._sum.inputTokens);
    outputTokens = add(outputTokens, r._sum.outputTokens);
    tokens = add(tokens, r._sum.tokens);

    if (rowCost != null) {
      cost = (cost ?? 0) + rowCost;
      pricedCalls += r._count.inputTokens;
    }

    return {
      model: r.model,
      calls: r._count._all,
      meteredCalls: r._count.inputTokens,
      inputTokens: r._sum.inputTokens,
      outputTokens: r._sum.outputTokens,
      estimatedCost: rowCost,
    };
  });

  return {
    provider,
    calls,
    meteredCalls,
    inputTokens,
    outputTokens,
    tokens,
    estimatedCost: cost,
    // What the estimate actually covers. When this is below `calls`, the cost
    // is a floor, not a total — the UI says so rather than implying completeness.
    pricedCalls,
    models,
  };
}

aiUsageRouter.get('/', async (req, res) => {
  const days = parseLimit(req.query.days, { def: DEFAULT_DAYS, max: MAX_DAYS });
  const since = new Date(Date.now() - days * DAY_MS);
  const where = { createdAt: { gte: since } };

  try {
    const [providerRows, workspaceRows, totalCalls, unattributedCalls, byDayRaw] = await Promise.all([
      // Grouped by provider AND model: the price lives on the model.
      prisma.aiUsageLog.groupBy({
        by: ['provider', 'model'],
        where,
        _sum: { inputTokens: true, outputTokens: true, tokens: true },
        _count: { _all: true, inputTokens: true },
      }),
      prisma.aiUsageLog.groupBy({
        by: ['workspaceId'],
        where: { ...where, workspaceId: { not: null } },
        _sum: { inputTokens: true, outputTokens: true, tokens: true },
        _count: { _all: true },
        orderBy: { _sum: { tokens: 'desc' } },
        take: MAX_WORKSPACE_ROWS,
      }),
      prisma.aiUsageLog.count({ where }),
      prisma.aiUsageLog.count({ where: { ...where, workspaceId: null } }),
      // Casts are not cosmetic: Postgres SUM()/COUNT() on integers return
      // bigint, which Prisma hands back as a JS BigInt — and JSON.stringify
      // THROWS on BigInt, so an uncast query 500s the whole route.
      prisma.$queryRaw`
        SELECT
          TO_CHAR(DATE_TRUNC('day', "createdAt"), 'YYYY-MM-DD') AS day,
          "provider",
          SUM("inputTokens")::float8  AS "inputTokens",
          SUM("outputTokens")::float8 AS "outputTokens",
          SUM("tokens")::float8       AS "tokens",
          COUNT(*)::int               AS calls
        FROM "ai_usage_logs"
        WHERE "createdAt" >= ${since}
        GROUP BY 1, 2
        ORDER BY 1 DESC
      `,
    ]);

    const grouped = new Map();
    for (const row of providerRows) {
      if (!grouped.has(row.provider)) grouped.set(row.provider, []);
      grouped.get(row.provider).push(row);
    }
    const byProvider = [...grouped.entries()]
      .map(([provider, rows]) => foldProvider(provider, rows))
      .sort((a, b) => b.calls - a.calls);

    // Sum of what IS priced. Stays null when nothing could be priced at all,
    // rather than collapsing "no data" into a confident $0.00.
    const priced = byProvider.filter((p) => p.estimatedCost != null);
    const estimatedCost = priced.length
      ? priced.reduce((sum, p) => sum + p.estimatedCost, 0)
      : null;

    return res.json({
      period: { days, since: since.toISOString() },
      totals: {
        calls: totalCalls,
        // Calls the cost estimate is actually built from.
        pricedCalls: byProvider.reduce((n, p) => n + p.pricedCalls, 0),
        // Calls with no workspace — real, and named rather than hand-waved.
        unattributedCalls,
        estimatedCost,
      },
      byProvider,
      byWorkspace: workspaceRows.map((w) => ({
        workspaceId: w.workspaceId,
        calls: w._count._all,
        inputTokens: w._sum.inputTokens,
        outputTokens: w._sum.outputTokens,
        tokens: w._sum.tokens,
      })),
      byDay: byDayRaw,
      pricingAsOf: PRICING_AS_OF,
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    logger.error({ err: err.message }, '[admin/ai-usage] summary failed');
    return res.status(500).json({ error: 'Failed to load AI usage' });
  }
});

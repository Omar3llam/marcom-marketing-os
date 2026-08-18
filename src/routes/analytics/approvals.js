// ============================================================
// Analytics Routes — PR #37: Approval Decision Intelligence
// ============================================================
// Query approval decision patterns for provider performance,
// feedback analysis, and artifact risk scoring.
//
// ENDPOINTS:
//   GET /api/analytics/approvals/summary
//   GET /api/analytics/approvals/by-provider
//   GET /api/analytics/approvals/by-capability
//   GET /api/analytics/approvals/feedback-patterns
//
// AUTHORIZATION:
//   Workspace-scoped via firebaseAuth + requireWorkspace (server.js mount).
//   NOTE (R11 · E9): this line used to name contextGuard, which is mounted
//   NOWHERE. The scoping was real — it comes from req.workspaceId and the
//   per-query predicates below — but the middleware named here never ran.
//   A false claim about which control protects a route is a security defect
//   in its own right: it is what the next reader trusts instead of checking.
//
// QUERY PARAMS (all endpoints):
//   ?startDate=YYYY-MM-DD (optional, default: 30 days ago)
//   ?endDate=YYYY-MM-DD   (optional, default: now)
// ============================================================
// R11 (F26): shared Prisma client — this module used to open its own pool.
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';


export function registerApprovalAnalyticsRoutes(router) {
  // ── GET /api/analytics/approvals/summary ──────────────────
  // Overall approval metrics: total decisions, approval rate,
  // rejection rate, regeneration rate, etc.
  router.get('/approvals/summary', async (req, res) => {
    try {
      const { workspaceId } = req;
      const { startDate, endDate } = _parseDateRange(req.query);

      const decisions = await prisma.approvalDecision.findMany({
        where: {
          workspaceId,
          reviewedAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        select: {
          decision: true,
          severity: true,
          reviewedAt: true,
        },
      });

      const total = decisions.length;
      const byDecision = _groupBy(decisions, 'decision');

      const summary = {
        total,
        dateRange: { startDate, endDate },
        decisions: {
          approved: byDecision.APPROVED?.length || 0,
          rejected: byDecision.REJECTED?.length || 0,
          regenerate: byDecision.REGENERATE?.length || 0,
          requestRevision: byDecision.REQUEST_REVISION?.length || 0,
          escalate: byDecision.ESCALATE?.length || 0,
        },
        rates: {
          approvalRate: total > 0 ? ((byDecision.APPROVED?.length || 0) / total) * 100 : 0,
          rejectionRate: total > 0 ? ((byDecision.REJECTED?.length || 0) / total) * 100 : 0,
          regenerationRate: total > 0 ? ((byDecision.REGENERATE?.length || 0) / total) * 100 : 0,
        },
        severity: {
          high: decisions.filter(d => d.severity === 'HIGH').length,
          medium: decisions.filter(d => d.severity === 'MEDIUM').length,
          low: decisions.filter(d => d.severity === 'LOW').length,
        },
      };

      res.json(summary);
    } catch (error) {
      logger.error({
        error: error.message,
        workspaceId: req.workspaceId,
      }, '[analytics/approvals] summary query failed');

      res.status(500).json({ error: 'Failed to load approval summary' });
    }
  });

  // ── GET /api/analytics/approvals/by-provider ──────────────
  // Provider performance comparison: approval rates by AI provider.
  router.get('/approvals/by-provider', async (req, res) => {
    try {
      const { workspaceId } = req;
      const { startDate, endDate } = _parseDateRange(req.query);

      const decisions = await prisma.approvalDecision.findMany({
        where: {
          workspaceId,
          reviewedAt: {
            gte: startDate,
            lte: endDate,
          },
          provider: { not: null },
        },
        select: {
          provider: true,
          decision: true,
          model: true,
        },
      });

      const byProvider = _groupBy(decisions, 'provider');
      const providerStats = {};

      for (const [provider, providerDecisions] of Object.entries(byProvider)) {
        const total = providerDecisions.length;
        const byDecision = _groupBy(providerDecisions, 'decision');

        providerStats[provider] = {
          total,
          decisions: {
            approved: byDecision.APPROVED?.length || 0,
            rejected: byDecision.REJECTED?.length || 0,
            regenerate: byDecision.REGENERATE?.length || 0,
            requestRevision: byDecision.REQUEST_REVISION?.length || 0,
          },
          approvalRate: total > 0 ? ((byDecision.APPROVED?.length || 0) / total) * 100 : 0,
          rejectionRate: total > 0 ? ((byDecision.REJECTED?.length || 0) / total) * 100 : 0,
          regenerationRate: total > 0 ? ((byDecision.REGENERATE?.length || 0) / total) * 100 : 0,
          models: [...new Set(providerDecisions.map(d => d.model).filter(Boolean))],
        };
      }

      res.json({
        dateRange: { startDate, endDate },
        providers: providerStats,
      });
    } catch (error) {
      logger.error({
        error: error.message,
        workspaceId: req.workspaceId,
      }, '[analytics/approvals] by-provider query failed');

      res.status(500).json({ error: 'Failed to load approvals by provider' });
    }
  });

  // ── GET /api/analytics/approvals/by-capability ────────────
  // Artifact type performance: which capabilities need most regen.
  router.get('/approvals/by-capability', async (req, res) => {
    try {
      const { workspaceId } = req;
      const { startDate, endDate } = _parseDateRange(req.query);

      const decisions = await prisma.approvalDecision.findMany({
        where: {
          workspaceId,
          reviewedAt: {
            gte: startDate,
            lte: endDate,
          },
          capability: { not: null },
        },
        select: {
          capability: true,
          decision: true,
        },
      });

      const byCapability = _groupBy(decisions, 'capability');
      const capabilityStats = {};

      for (const [capability, capabilityDecisions] of Object.entries(byCapability)) {
        const total = capabilityDecisions.length;
        const byDecision = _groupBy(capabilityDecisions, 'decision');

        const regenCount = (byDecision.REGENERATE?.length || 0) + (byDecision.REQUEST_REVISION?.length || 0);

        capabilityStats[capability] = {
          total,
          decisions: {
            approved: byDecision.APPROVED?.length || 0,
            rejected: byDecision.REJECTED?.length || 0,
            regenerate: byDecision.REGENERATE?.length || 0,
            requestRevision: byDecision.REQUEST_REVISION?.length || 0,
          },
          approvalRate: total > 0 ? ((byDecision.APPROVED?.length || 0) / total) * 100 : 0,
          regenerationRate: total > 0 ? (regenCount / total) * 100 : 0,
          riskScore: _calculateRiskScore(byDecision, total),
        };
      }

      res.json({
        dateRange: { startDate, endDate },
        capabilities: capabilityStats,
      });
    } catch (error) {
      logger.error({
        error: error.message,
        workspaceId: req.workspaceId,
      }, '[analytics/approvals] by-capability query failed');

      res.status(500).json({ error: 'Failed to load approvals by capability' });
    }
  });

  // ── GET /api/analytics/approvals/feedback-patterns ────────
  // Most common feedback types and severity levels.
  router.get('/approvals/feedback-patterns', async (req, res) => {
    try {
      const { workspaceId } = req;
      const { startDate, endDate } = _parseDateRange(req.query);

      const decisions = await prisma.approvalDecision.findMany({
        where: {
          workspaceId,
          reviewedAt: {
            gte: startDate,
            lte: endDate,
          },
          feedbackType: { not: null },
        },
        select: {
          feedbackType: true,
          severity: true,
          decision: true,
          preserveAspects: true,
        },
      });

      const byFeedbackType = _groupBy(decisions, 'feedbackType');
      const feedbackPatterns = {};

      for (const [feedbackType, feedbackDecisions] of Object.entries(byFeedbackType)) {
        const total = feedbackDecisions.length;
        const bySeverity = _groupBy(feedbackDecisions, 'severity');
        const byDecision = _groupBy(feedbackDecisions, 'decision');

        // Flatten preserveAspects arrays and count frequency
        const allPreserveAspects = feedbackDecisions
          .flatMap(d => d.preserveAspects || []);
        const preserveAspectCounts = _countFrequency(allPreserveAspects);

        feedbackPatterns[feedbackType] = {
          count: total,
          severity: {
            high: bySeverity.HIGH?.length || 0,
            medium: bySeverity.MEDIUM?.length || 0,
            low: bySeverity.LOW?.length || 0,
          },
          decisions: {
            regenerate: byDecision.REGENERATE?.length || 0,
            requestRevision: byDecision.REQUEST_REVISION?.length || 0,
          },
          commonPreserveAspects: _topN(preserveAspectCounts, 3),
        };
      }

      // Sort by count descending
      const sortedPatterns = Object.entries(feedbackPatterns)
        .sort(([, a], [, b]) => b.count - a.count)
        .reduce((acc, [key, value]) => {
          acc[key] = value;
          return acc;
        }, {});

      res.json({
        dateRange: { startDate, endDate },
        total: decisions.length,
        patterns: sortedPatterns,
      });
    } catch (error) {
      logger.error({
        error: error.message,
        workspaceId: req.workspaceId,
      }, '[analytics/approvals] feedback-patterns query failed');

      res.status(500).json({ error: 'Failed to load feedback patterns' });
    }
  });
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Parse date range from query params.
 * Defaults to last 30 days.
 */
function _parseDateRange(query) {
  const endDate = query.endDate ? new Date(query.endDate) : new Date();
  const startDate = query.startDate
    ? new Date(query.startDate)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

  return { startDate, endDate };
}

/**
 * Group array of objects by field value.
 */
function _groupBy(array, field) {
  return array.reduce((acc, item) => {
    const key = item[field];
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

/**
 * Calculate risk score for capability based on rejection patterns.
 * Higher score = more problematic.
 */
function _calculateRiskScore(byDecision, total) {
  if (total === 0) return 0;

  const rejected = byDecision.REJECTED?.length || 0;
  const regenerate = byDecision.REGENERATE?.length || 0;
  const requestRevision = byDecision.REQUEST_REVISION?.length || 0;

  // Weighted score: rejection = 3pts, regenerate = 2pts, revision = 1pt
  const score = (rejected * 3 + regenerate * 2 + requestRevision * 1) / total;

  return Math.round(score * 100) / 100; // Round to 2 decimals
}

/**
 * Count frequency of items in array.
 */
function _countFrequency(array) {
  return array.reduce((acc, item) => {
    acc[item] = (acc[item] || 0) + 1;
    return acc;
  }, {});
}

/**
 * Get top N items from frequency object.
 */
function _topN(frequencyObj, n) {
  return Object.entries(frequencyObj)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([key, count]) => ({ aspect: key, count }));
}

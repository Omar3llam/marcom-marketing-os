// ============================================================
// MARCOM / Lumi — Provider Performance Metrics
// GET /api/observability/providers
// ============================================================
// Aggregates execution metrics by AI provider (Claude, OpenAI, etc.)
// for the last 24 hours. Shows success rate, avg latency, approval
// rate, and token consumption. Read-only, workspace-scoped.
// ============================================================
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';

export const providersRouter = Router();

// ─────────────────────────────────────────────────────────────
// GET /api/observability/providers
// ─────────────────────────────────────────────────────────────
providersRouter.get('/providers', async (req, res) => {
  const workspaceId = req.workspaceId;
  if (!workspaceId) return res.status(403).json({ error: 'Workspace not resolved — please reload' });

  try {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const runQuery = async (name, fn) => {
      try {
        return await fn();
      } catch (err) {
        console.error({
          msg: `[observability/providers] query failed: ${name}`,
          workspaceId,
          errorCode: err.code,
          errorMessage: err.message,
          meta: err.meta,
        });
        throw err;
      }
    };

    // Fetch execution metrics from last 24h
    const metrics = await runQuery('findMany:executionMetrics', () =>
      prisma.executionMetric.findMany({
        where: {
          workspaceId,
          recordedAt: { gte: twentyFourHoursAgo },
        },
        select: {
          agentUsed: true,
          finalStatus: true,
          executionMs: true,
          tokenEstimate: true,
          executionId: true,
        },
      })
    );

    // Fetch approval decisions from last 24h for approval rate calculation
    const approvals = await runQuery('findMany:approvalDecisions', () =>
      prisma.approvalDecision.findMany({
        where: {
          workspaceId,
          reviewedAt: { gte: twentyFourHoursAgo },
        },
        select: {
          provider: true,
          decision: true,
        },
      })
    );

    // Group metrics by provider
    const providerStats = {};

    metrics.forEach((m) => {
      const provider = m.agentUsed || 'unknown';
      if (!providerStats[provider]) {
        providerStats[provider] = {
          executions: 0,
          successes: 0,
          total_latency_ms: 0,
          total_tokens: 0,
        };
      }

      providerStats[provider].executions++;
      if (m.finalStatus === 'EXECUTED_SUCCESS') {
        providerStats[provider].successes++;
      }
      if (m.executionMs) {
        providerStats[provider].total_latency_ms += m.executionMs;
      }
      if (m.tokenEstimate) {
        providerStats[provider].total_tokens += m.tokenEstimate;
      }
    });

    // Group approvals by provider
    const approvalStats = {};
    approvals.forEach((a) => {
      const provider = a.provider || 'unknown';
      if (!approvalStats[provider]) {
        approvalStats[provider] = { total: 0, approved: 0 };
      }
      approvalStats[provider].total++;
      if (a.decision === 'APPROVED') {
        approvalStats[provider].approved++;
      }
    });

    // Combine and format provider data
    const providers = Object.keys(providerStats).map((provider) => {
      const stats = providerStats[provider];
      const approvalData = approvalStats[provider] || { total: 0, approved: 0 };

      const successRate = stats.executions > 0
        ? stats.successes / stats.executions
        : 0;

      const avgLatencyMs = stats.executions > 0
        ? Math.round(stats.total_latency_ms / stats.executions)
        : 0;

      const approvalRate = approvalData.total > 0
        ? approvalData.approved / approvalData.total
        : null;

      return {
        provider,
        executions: stats.executions,
        success_rate: Math.round(successRate * 100) / 100,
        avg_latency_ms: avgLatencyMs,
        approval_rate: approvalRate !== null ? Math.round(approvalRate * 100) / 100 : null,
        token_estimate: stats.total_tokens,
        approvals: {
          total: approvalData.total,
          approved: approvalData.approved,
        },
      };
    });

    // Sort by execution count (most used first)
    providers.sort((a, b) => b.executions - a.executions);

    return res.json({
      window: 'last_24h',
      providers,
      generated_at: now.toISOString(),
    });
  } catch (err) {
    console.error({
      msg: '[observability/providers] unhandled error',
      workspaceId,
      errorCode: err.code,
      errorMessage: err.message,
      meta: err.meta,
    });
    return res.status(500).json({ error: 'Failed to fetch provider metrics' });
  }
});

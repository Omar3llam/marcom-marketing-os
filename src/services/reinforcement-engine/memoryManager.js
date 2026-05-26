// ============================================================
// Reinforcement Memory Manager — PR #42
// ============================================================
// Manages ReinforcementSnapshot CRUD operations and historical queries.
//
// FEATURES:
//   - Append-only snapshots (no updates or deletes)
//   - Query historical performance trends
//   - Track score evolution over time
//   - Workspace-scoped queries
//
// USAGE:
//   await saveSnapshot({ provider, capability, score, confidence, ... });
//   const history = await getSnapshotHistory('claude', 'GENERATE_HOOKS');
//   const latest = await getLatestSnapshot('claude', 'GENERATE_HOOKS');
//
// SAFETY:
//   - All writes are append-only (audit trail)
//   - No mutation of existing snapshots
//   - Timestamps are immutable
// ============================================================
import { PrismaClient } from '@prisma/client';
import { logger } from '../../utils/logger.js';

const prisma = new PrismaClient();

/**
 * Save a new reinforcement snapshot.
 *
 * Snapshots are append-only and immutable once created.
 *
 * @param {object} snapshot - Snapshot data
 * @param {string} snapshot.provider - Provider name
 * @param {string} snapshot.capability - Capability name
 * @param {number} snapshot.score - Composite score (0-100)
 * @param {number} snapshot.confidence - Confidence level (0.0-1.0)
 * @param {number} snapshot.sampleSize - Number of data points
 * @param {Date} snapshot.windowStart - Performance window start
 * @param {Date} snapshot.windowEnd - Performance window end
 * @param {string} snapshot.workspaceId - Workspace ID (optional)
 * @returns {Promise<object>} Created snapshot
 */
export async function saveSnapshot(snapshot) {
  const {
    provider,
    capability,
    score,
    confidence,
    sampleSize,
    windowStart,
    windowEnd,
    workspaceId = null,
  } = snapshot;

  // Validation
  if (!provider || !capability) {
    throw new Error('provider and capability are required');
  }

  if (typeof score !== 'number' || score < 0 || score > 100) {
    throw new Error(`Invalid score: ${score} (must be 0-100)`);
  }

  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
    throw new Error(`Invalid confidence: ${confidence} (must be 0.0-1.0)`);
  }

  if (typeof sampleSize !== 'number' || sampleSize < 0) {
    throw new Error(`Invalid sampleSize: ${sampleSize} (must be >= 0)`);
  }

  if (!(windowStart instanceof Date) || !(windowEnd instanceof Date)) {
    throw new Error('windowStart and windowEnd must be Date objects');
  }

  if (windowStart >= windowEnd) {
    throw new Error('windowStart must be before windowEnd');
  }

  logger.info({
    provider,
    capability,
    score,
    confidence,
    sampleSize,
    workspaceId,
  }, '[memoryManager] saving reinforcement snapshot');

  const created = await prisma.reinforcementSnapshot.create({
    data: {
      provider,
      capability,
      score,
      confidence,
      sampleSize,
      windowStart,
      windowEnd,
      workspaceId,
    },
  });

  return created;
}

/**
 * Get snapshot history for a provider + capability pair.
 *
 * Returns snapshots ordered by createdAt descending (newest first).
 *
 * @param {string} provider - Provider name
 * @param {string} capability - Capability name
 * @param {object} options - Query options
 * @param {string} options.workspaceId - Workspace ID for filtering (optional)
 * @param {number} options.limit - Maximum number of snapshots to return (optional, default 30)
 * @param {Date} options.since - Only return snapshots created after this date (optional)
 * @returns {Promise<Array<object>>} Snapshot history (newest first)
 */
export async function getSnapshotHistory(provider, capability, options = {}) {
  const {
    workspaceId = null,
    limit = 30,
    since = null,
  } = options;

  const where = {
    provider,
    capability,
  };

  if (workspaceId) {
    where.workspaceId = workspaceId;
  }

  if (since) {
    where.createdAt = { gte: since };
  }

  const snapshots = await prisma.reinforcementSnapshot.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  logger.debug({
    provider,
    capability,
    workspaceId,
    snapshotsFound: snapshots.length,
  }, '[memoryManager] retrieved snapshot history');

  return snapshots;
}

/**
 * Get the latest snapshot for a provider + capability pair.
 *
 * @param {string} provider - Provider name
 * @param {string} capability - Capability name
 * @param {object} options - Query options
 * @param {string} options.workspaceId - Workspace ID for filtering (optional)
 * @returns {Promise<object|null>} Latest snapshot or null if none exist
 */
export async function getLatestSnapshot(provider, capability, options = {}) {
  const { workspaceId = null } = options;

  const where = {
    provider,
    capability,
  };

  if (workspaceId) {
    where.workspaceId = workspaceId;
  }

  const snapshot = await prisma.reinforcementSnapshot.findFirst({
    where,
    orderBy: { createdAt: 'desc' },
  });

  logger.debug({
    provider,
    capability,
    workspaceId,
    found: !!snapshot,
  }, '[memoryManager] retrieved latest snapshot');

  return snapshot;
}

/**
 * Get all latest snapshots for a capability (one per provider).
 *
 * Returns the most recent snapshot for each provider that supports the capability.
 *
 * @param {string} capability - Capability name
 * @param {object} options - Query options
 * @param {string} options.workspaceId - Workspace ID for filtering (optional)
 * @returns {Promise<Array<object>>} Latest snapshot per provider
 */
export async function getLatestSnapshotsForCapability(capability, options = {}) {
  const { workspaceId = null } = options;

  // Query all snapshots for this capability
  const where = { capability };
  if (workspaceId) {
    where.workspaceId = workspaceId;
  }

  const snapshots = await prisma.reinforcementSnapshot.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  // Group by provider and take latest
  const latestByProvider = new Map();

  for (const snapshot of snapshots) {
    if (!latestByProvider.has(snapshot.provider)) {
      latestByProvider.set(snapshot.provider, snapshot);
    }
  }

  const result = Array.from(latestByProvider.values());

  logger.debug({
    capability,
    workspaceId,
    providersFound: result.length,
  }, '[memoryManager] retrieved latest snapshots for capability');

  return result;
}

/**
 * Calculate score trend for a provider + capability pair.
 *
 * Returns trend analysis: improving, stable, or declining.
 *
 * @param {string} provider - Provider name
 * @param {string} capability - Capability name
 * @param {object} options - Query options
 * @param {string} options.workspaceId - Workspace ID for filtering (optional)
 * @param {number} options.lookbackDays - Number of days to analyze (default 30)
 * @returns {Promise<{ trend: string, change: number, snapshots: number }>}
 */
export async function calculateScoreTrend(provider, capability, options = {}) {
  const {
    workspaceId = null,
    lookbackDays = 30,
  } = options;

  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const snapshots = await getSnapshotHistory(provider, capability, {
    workspaceId,
    since,
    limit: 100,
  });

  if (snapshots.length < 2) {
    return {
      trend: 'unknown',
      change: 0,
      snapshots: snapshots.length,
    };
  }

  // Compare latest score vs average of older scores
  const latest = snapshots[0];
  const older = snapshots.slice(1);

  const olderAverage = older.reduce((sum, s) => sum + s.score, 0) / older.length;
  const change = latest.score - olderAverage;

  let trend;
  if (change > 5) {
    trend = 'improving';
  } else if (change < -5) {
    trend = 'declining';
  } else {
    trend = 'stable';
  }

  logger.debug({
    provider,
    capability,
    trend,
    change: Math.round(change * 100) / 100,
    snapshots: snapshots.length,
  }, '[memoryManager] calculated score trend');

  return {
    trend,
    change: Math.round(change * 100) / 100,
    snapshots: snapshots.length,
  };
}

/**
 * Get aggregate statistics across all providers for a capability.
 *
 * @param {string} capability - Capability name
 * @param {object} options - Query options
 * @param {string} options.workspaceId - Workspace ID for filtering (optional)
 * @returns {Promise<{ providers: number, avgScore: number, avgConfidence: number, totalSampleSize: number }>}
 */
export async function getCapabilityStats(capability, options = {}) {
  const { workspaceId = null } = options;

  const snapshots = await getLatestSnapshotsForCapability(capability, { workspaceId });

  if (snapshots.length === 0) {
    return {
      providers: 0,
      avgScore: 0,
      avgConfidence: 0,
      totalSampleSize: 0,
    };
  }

  const avgScore = snapshots.reduce((sum, s) => sum + s.score, 0) / snapshots.length;
  const avgConfidence = snapshots.reduce((sum, s) => sum + s.confidence, 0) / snapshots.length;
  const totalSampleSize = snapshots.reduce((sum, s) => sum + s.sampleSize, 0);

  return {
    providers: snapshots.length,
    avgScore: Math.round(avgScore * 100) / 100,
    avgConfidence: Math.round(avgConfidence * 100) / 100,
    totalSampleSize,
  };
}

/**
 * Cognitive Selectors — Extract trust, confidence, urgency from domain data
 *
 * These selectors map domain state (campaign stage, alert priority, metrics)
 * to cognitive dimensions (trust tier, confidence level, urgency).
 *
 * Pure functions — no side effects, easily testable.
 */
import type { Campaign, Alert } from '@/contracts/schemas';

/**
 * Extract trust state from campaign data.
 * Maps campaign stage → trust tier.
 *
 * DYING/FATIGUED = HIGH trust (urgent, high-confidence diagnosis)
 * TESTING = MEDIUM trust (observational period)
 * SCALING/STABLE = LOW trust (maintenance mode)
 */
export function extractTrustTier(campaign: Campaign): 'HIGH' | 'MEDIUM' | 'LOW' {
  const trustMap = {
    DYING: 'HIGH',      // Urgent action needed
    FATIGUED: 'HIGH',   // High confidence in diagnosis
    TESTING: 'MEDIUM',  // Observational period
    SCALING: 'LOW',     // Minor optimizations
    STABLE: 'LOW',      // Maintenance mode
  } as const;
  return trustMap[campaign.stage];
}

/**
 * Extract execution state from alert.
 * Determines if action is ready for execution.
 *
 * PENDING → READY
 * QUEUED/EXECUTING → IN_PROGRESS
 * EXECUTED_SUCCESS → COMPLETED
 * EXECUTED_FAILED → BLOCKED
 */
export function extractExecutionState(
  alert: Alert
): 'READY' | 'BLOCKED' | 'IN_PROGRESS' | 'COMPLETED' {
  const status = alert.action_plan.status;
  if (status === 'PENDING') return 'READY';
  if (status === 'QUEUED' || status === 'EXECUTING') return 'IN_PROGRESS';
  if (status === 'EXECUTED_SUCCESS') return 'COMPLETED';
  return 'BLOCKED'; // EXECUTED_FAILED
}

/**
 * Extract confidence tier from alert priority.
 * Direct mapping: alert.priority === confidence tier.
 */
export function extractConfidenceTier(alert: Alert): 'HIGH' | 'MEDIUM' | 'LOW' {
  return alert.priority;
}

/**
 * Extract urgency tier from metrics status.
 * Counts danger/warning signals → urgency level.
 *
 * 3+ danger metrics → CRITICAL
 * 1+ danger OR 3+ warning → HIGH
 * 1+ warning → MEDIUM
 * Otherwise → LOW
 */
export function extractUrgencyTier(alert: Alert): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' {
  const dangerCount = alert.metrics.filter((m) => m.status === 'danger').length;
  const warningCount = alert.metrics.filter((m) => m.status === 'warning').length;

  if (dangerCount >= 3) return 'CRITICAL';
  if (dangerCount >= 1 || warningCount >= 3) return 'HIGH';
  if (warningCount >= 1) return 'MEDIUM';
  return 'LOW';
}

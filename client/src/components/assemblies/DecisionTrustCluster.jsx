// ============================================================
// Decision Trust Cluster — Semantic Assembly
// ============================================================
// Composite trust signal for AI-generated decisions.
// Combines verdict + title + confidence + risk into a single
// cohesive unit that appears consistently across all decision UIs.
//
// Philosophy:
//   - Assembly of primitives, not a primitive itself
//   - Domain semantics: "trust cluster" is a real UX concept
//   - Stable API: same props everywhere
//   - DRY: changes to trust visualization happen here
//
// Architecture:
//   Primitives (atoms) → Assemblies (molecules) → Pages (organisms)
// ============================================================
import { cn } from '@/lib/utils.js';
import {
  VerdictBadge,
  DecisionTitle,
  ConfidenceIndicator,
  RiskSignal,
} from '@/components/primitives';

/**
 * @typedef {'low' | 'medium' | 'high'} RiskLevel
 * @typedef {'scale' | 'pause' | 'kill'} Verdict
 */

// Map legacy risk levels to RiskSignal severity
function mapRiskLevelToSeverity(level) {
  const map = { low: 'low', medium: 'medium', high: 'critical' };
  return map[level] || 'medium';
}

/**
 * Complete trust signal for an AI decision.
 * Shows verdict badge + decision title + confidence + risk in a cohesive layout.
 *
 * @param {Object} props
 * @param {Verdict} props.verdict - Decision verdict (scale/pause/kill)
 * @param {string} props.title - Decision title/headline
 * @param {number} props.confidence - Confidence score 0-100 (will be normalized to 0-1)
 * @param {RiskLevel} props.riskLevel - Risk assessment (low/medium/high)
 * @param {boolean} [props.showConfidenceLabel=true] - Show "Confidence" label on indicator
 * @param {boolean} [props.showRiskIcon=true] - Show icon on risk signal
 * @param {string} [props.className] - Additional wrapper classes
 */
export function DecisionTrustCluster({
  verdict,
  title,
  confidence,
  riskLevel,
  showConfidenceLabel = true,
  showRiskIcon = true,
  className,
  ...props
}) {
  // Normalize confidence to 0-1 if it's 0-100
  const normalizedConfidence = confidence > 1 ? confidence / 100 : confidence;
  const riskSeverity = mapRiskLevelToSeverity(riskLevel);

  return (
    <div
      className={cn(
        'flex flex-col sm:flex-row sm:items-center gap-4',
        className,
      )}
      {...props}
    >
      <VerdictBadge verdict={verdict} />
      <div className="flex-1">
        <DecisionTitle as="h1" className="text-lumi-text">
          {title}
        </DecisionTitle>
        <div className="mt-2 flex items-center gap-3">
          <ConfidenceIndicator
            level={normalizedConfidence}
            showLabel={showConfidenceLabel}
          />
          <RiskSignal
            severity={riskSeverity}
            showIcon={showRiskIcon}
          />
        </div>
      </div>
    </div>
  );
}

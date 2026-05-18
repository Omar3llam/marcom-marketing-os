// ============================================================
// MARCOM Semantic Primitives — Barrel Export
// ============================================================
// The UI Runtime Layer: purpose-driven, polymorphic primitives.
//
// Philosophy:
//   - Semantic purpose over visual appearance
//   - API governance over CSS governance
//   - Component architecture over utility chaos
//
// Usage:
//   import { DecisionTitle, MetricValue } from '@/primitives';
// ============================================================

// Core engines
export { Text } from './core/Text';

// Typography primitives
export { DecisionTitle }  from './typography/DecisionTitle';
export { MetricValue }    from './typography/MetricValue';
export { SectionLabel }   from './typography/SectionLabel';
export { BodyMuted }      from './typography/BodyMuted';
export { BodySubtle }     from './typography/BodySubtle';

// State primitives (business signals)
export { VerdictBadge }   from './signals/VerdictBadge';

// Decision flow primitives (cognitive layer)
export { ConfidenceIndicator }      from './flows/ConfidenceIndicator';
export { RiskSignal }               from './flows/RiskSignal';
export { UrgencyBadge }             from './flows/UrgencyBadge';
export { RecommendationStrength }   from './flows/RecommendationStrength';

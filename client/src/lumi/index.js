// ============================================================
// LUMI primitives and grammar parts (Phase 3)
// ------------------------------------------------------------
// Registry and documentation: ./README.md. Nothing in the application imports
// this module yet; surfaces adopt it when they migrate (Phase 5).
// ============================================================

// Primitives — grammar-agnostic (COMPONENT_RULES.md CMP-01)
export { Environment, useGround, ENVIRONMENT_GROUNDS } from './primitives/Environment.jsx';
export { Surface, BOUNDARY_REASONS } from './primitives/Surface.jsx';
export { Stack, Inline, Rule, GAP_TIERS } from './primitives/Flow.jsx';
export { Text, Heading, VisuallyHidden } from './primitives/Text.jsx';
export { Icon, Announcement, FORBIDDEN_GLYPHS } from './primitives/Icon.jsx';
export { Button, IconButton } from './primitives/Button.jsx';
export { TextLink } from './primitives/TextLink.jsx';
export { TextField, SelectField } from './primitives/TextField.jsx';
export { CheckboxField, RadioGroup } from './primitives/ChoiceField.jsx';

// Grammar parts — express a grammar object (COMPONENT_RULES.md CMP-02)
export { VerdictMark } from './grammar/VerdictMark.jsx';
export { TenseLabel, AgreementNote } from './grammar/Tense.jsx';
export { DecisionIdentity } from './grammar/DecisionIdentity.jsx';
export { Spine, SpineStage, SPINE_STAGES } from './grammar/Spine.jsx';
export { ClaimState, CLAIM_STATES } from './grammar/ClaimState.jsx';
export { EvidenceGroup } from './grammar/EvidenceGroup.jsx';
export { Measurement, Money } from './grammar/Measurement.jsx';
export { ActionControl } from './grammar/ActionControl.jsx';

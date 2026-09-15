// ============================================================
// LUMI landing — page-level compositions shared by its sections
// ------------------------------------------------------------
// These are PAGE parts (FC-18: … → PRODUCT SURFACE COMPONENTS → PAGES), built
// only from Phase 3 primitives. None is a new primitive: each has one consumer,
// this page (COMPONENT_RULES.md CMP-01 §2 needs two).
// ============================================================
import { Link } from 'react-router-dom';
import { Heading, Stack, Text } from '../index.js';
import css from './landing.module.css';

/** One question of the page: an anchored section with its title and lead. */
export function LandingSection({ id, title, lead, children }) {
  const titleId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={titleId} className={css.section}>
      <div className={css.frame}>
        <Stack gap="section">
          <div className={css.claimColumn}>
            <Stack gap="object">
              <Heading level={2} variant="surface" id={titleId}>{title}</Heading>
              {lead && <Text variant="claim" light="body" as="p">{lead}</Text>}
            </Stack>
          </div>
          {children}
        </Stack>
      </div>
    </section>
  );
}

/**
 * Constitution Article 28 / 🔒 PR-7: an illustration is labelled adjacent to its
 * content, at readable size, in words that cannot be mistaken for product data.
 */
export function IllustrativeNote({ children }) {
  return (
    <Text variant="caption" light="body" as="p">
      {`Illustrative example — ${children}`}
    </Text>
  );
}

/**
 * A sequence read on one line: vertical when narrow, horizontal when the whole
 * sequence fits (Article 8 §1). Used for the product model and for memory.
 */
export function Axis({ label, stops }) {
  return (
    <ol aria-label={label} className={css.axis}>
      {stops.map(([name, description]) => (
        <li key={name} className={css.axisStop}>
          <Text variant="claim" as="p">{name}</Text>
          <Text variant="body" as="p">{description}</Text>
        </li>
      ))}
    </ol>
  );
}

/**
 * ⚠️ PLACEHOLDER — the approved logo "01 / Current Base" is not in the repository
 * (Constitution FC-10; design-governance/brand/README.md: SOURCE REQUIRED).
 * The mark is not recreated, redrawn or approximated. This labelled text link
 * holds its place and is the ONLY file to change when the asset arrives. It is
 * set in a UI role, deliberately not in Space Grotesk, so it cannot pass as the
 * custom wordmark.
 */
export function BrandPlaceholder() {
  return (
    <Link to="/" className={css.brandPlaceholder} data-brand-placeholder="logo 01 / Current Base — source required">
      LUMI
    </Link>
  );
}

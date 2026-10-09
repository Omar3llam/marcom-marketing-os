// ============================================================
// LUMI landing — page-level compositions shared by its sections
// ------------------------------------------------------------
// These are PAGE parts (FC-18: … → PRODUCT SURFACE COMPONENTS → PAGES), built
// only from Phase 3 primitives. None is a new primitive: each has one consumer,
// this page (COMPONENT_RULES.md CMP-01 §2 needs two).
// ============================================================
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Heading, Stack, Text } from '../index.js';
import { cx } from '../contract.js';
import css from './landing.module.css';

const primaryLogo = '/brand/lumi-primary-lockup-v1.svg';
const symbolLogo = '/brand/lumi-symbol-v1.svg';

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
 * Exact owner-approved Illustrator exports (Brand v1, 2026-10-08).
 * The header uses the symbol; the footer has room for the stacked wordmark.
 * Local CSS chooses the variant without rearranging any vector geometry.
 * One link name avoids duplicate image announcements; failed images retain text.
 */
export function BrandMark() {
  const [symbolFailed, setSymbolFailed] = useState(false);
  const [primaryFailed, setPrimaryFailed] = useState(false);
  return (
    <Link to="/" className={css.brandMark} aria-label="LUMI" data-lumi-brand="v1">
      <span className={cx(css.brandSymbol, symbolFailed && css.brandFallback)}>
        {symbolFailed ? 'LUMI' : <img src={symbolLogo} width={37867} height={23485} alt="" onError={() => setSymbolFailed(true)} />}
      </span>
      <span className={cx(css.brandPrimary, primaryFailed && css.brandFallback)}>
        {primaryFailed ? 'LUMI' : <img src={primaryLogo} width={37867} height={34442} alt="" onError={() => setPrimaryFailed(true)} />}
      </span>
    </Link>
  );
}

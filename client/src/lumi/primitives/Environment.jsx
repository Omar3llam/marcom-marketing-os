// ============================================================
// Environment — the ground every coloured LUMI part stands on
// ------------------------------------------------------------
// Colour tokens exist only inside [data-lumi-env] (DESIGN_TOKEN_ARCHITECTURE.md
// §5). A part rendered outside one would silently lose every colour, so
// coloured parts call `useGround()` and throw instead of rendering unstyled.
//
// The environment is a product context (🔒 PR-9), not a theme: there is no
// switch, and nothing here reads a user preference.
// ============================================================
import { createContext, useContext } from 'react';
import { assertOneOf, assertProps, cx } from '../contract.js';
import css from './layout.module.css';

/** Environment → ground. Mirrors semantic.json `$environments`; a test holds them equal. */
export const ENVIRONMENT_GROUNDS = Object.freeze({
  product: 'charcoal',
  marketing: 'offWhite',
  'marketing-dark-section': 'charcoal',
});

const GroundContext = createContext(null);

export function Environment(props) {
  assertProps('Environment', props, ['env']);
  const { env, children, ...pass } = props;
  assertOneOf('Environment', 'env', env, Object.keys(ENVIRONMENT_GROUNDS));

  return (
    <GroundContext.Provider value={{ env, ground: ENVIRONMENT_GROUNDS[env] }}>
      <div
        {...pass}
        data-lumi-env={env}
        className={cx(css.environment, ENVIRONMENT_GROUNDS[env] === 'charcoal' ? css.groundCharcoal : css.groundOffWhite)}
      >
        {children}
      </div>
    </GroundContext.Provider>
  );
}

/**
 * The nearest environment, for parts that consume colour tokens.
 * @returns {{ env: string, ground: 'charcoal' | 'offWhite' }}
 */
export function useGround(component) {
  const value = useContext(GroundContext);
  if (!value) {
    throw new Error(
      `${component} must render inside <Environment>. Colour tokens exist only inside an `
      + 'environment (DESIGN_TOKEN_ARCHITECTURE.md §5).',
    );
  }
  return value;
}

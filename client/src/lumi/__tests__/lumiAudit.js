// ============================================================
// The static instrument behind tokenUsage.test.js. Not a test file.
// ------------------------------------------------------------
// Reads the LUMI CSS modules and source files as text and returns every
// violation of the token contract. Each checker is also run against planted
// violations in the test, so a checker that cannot fail is caught
// (Instrument Falsification Rule).
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { localDir } from '../../../design-system/foundation/resolve.js';

export const LUMI_DIR = localDir('../', import.meta.url);
export const TOKENS_CSS = localDir('../../../design-system/foundation/generated/tokens.css', import.meta.url);

export function lumiFiles(predicate) {
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== '__tests__') walk(full); } else if (predicate(entry.name)) out.push(full);
    }
  })(LUMI_DIR);
  return out.sort();
}

export const definedTokens = (tokensCss) => new Set([...tokensCss.matchAll(/(--lumi-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');

/** CSS rules as { selector, body }, with @media wrappers flattened. */
export function cssRules(text) {
  const rules = [];
  const flat = stripComments(text).replace(/@media[^{]*\{([\s\S]*?\})\s*\}/g, '$1');
  for (const match of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selector: match[1].trim(), body: match[2].trim() });
  }
  return rules;
}

const VERDICT_VAR = /--lumi-color-verdict-[a-z]+-mark/;
const ATTENTION_VAR = /--lumi-color-signal-attention/;
const STATE_VAR = /--lumi-color-state-/;
const INTERACTION_SELECTOR = /:hover|:active|:focus|aria-disabled|aria-current|aria-selected|:checked/;
const LENGTH = /(^|[^\w-])-?\d*\.?\d+(px|rem|em|ms|s|vh|vw|%)\b/;

/** Every violation of the token contract in one CSS module's text. */
export function auditCss(text, defined) {
  const violations = [];
  const flag = (selector, message) => violations.push(`${selector}: ${message}`);
  for (const { selector, body } of cssRules(text)) {
    for (const [, name, fallback] of body.matchAll(/var\((--[a-z0-9-]+)\s*(,[^)]*)?\)/gi)) {
      if (!name.startsWith('--lumi-')) flag(selector, `non-LUMI variable ${name}`);
      else if (!defined.has(name)) flag(selector, `undefined token ${name}`);
      if (fallback) flag(selector, `var() fallback on ${name}`);
    }
    const values = body.replace(/var\([^)]*\)/g, 'TOKEN');
    if (/#[0-9a-f]{3,8}\b/i.test(values)) flag(selector, 'raw hex colour');
    if (/\b(rgb|rgba|hsl|hsla|hwb|lab|lch|oklch|color-mix)\(/i.test(values)) flag(selector, 'raw colour function');
    if (/:\s*(white|black|red|green|blue|gold|gray|grey|orange|yellow|purple)\b/i.test(values)) flag(selector, 'named colour');
    if (/gradient|backdrop-filter|(^|[\s;])filter\s*:|blur\(|text-shadow|animation|@keyframes|!important/i.test(body)) {
      flag(selector, 'forbidden effect (gradient, blur, glow, animation or !important)');
    }
    // `box-shadow: none` is a reset, not an effect: it removes the legacy global
    // gold focus ring (client/src/index.css :focus-visible) from LUMI controls.
    if (/box-shadow\s*:/.test(body) && !/box-shadow\s*:\s*(var\(--lumi-shadow-overlay\)|none)\s*(;|$)/.test(body)) {
      flag(selector, 'box-shadow other than shadow.overlay');
    }
    if (/font-family\s*:/.test(body) && !/font-family\s*:\s*var\(--lumi-type-[a-z-]+-family\)/.test(body)) {
      flag(selector, 'font-family not from a type role');
    }
    // Exempt: the standard visually-hidden clip (an accessibility technique, not
    // a design value) and a control filling its field's width.
    if (selector !== '.visuallyHidden') {
      for (const declaration of values.split(';').map((d) => d.trim()).filter(Boolean)) {
        if (/^width\s*:\s*100%$/.test(declaration)) continue;
        if (LENGTH.test(declaration)) flag(selector, `raw length or duration in "${declaration}"`);
      }
    }
    if (VERDICT_VAR.test(body) && !/^\.mark[A-Z]\w*$/.test(selector)) flag(selector, 'verdict mark colour outside a .mark rule');
    if (ATTENTION_VAR.test(body)) flag(selector, 'attention signal (gold) used');
    if (INTERACTION_SELECTOR.test(selector) && (VERDICT_VAR.test(body) || ATTENTION_VAR.test(body) || STATE_VAR.test(body))) {
      flag(selector, 'interaction state uses a verdict, gold or state colour');
    }
  }
  return violations;
}

// Checked against import SPECIFIERS only, so a comment naming a legacy file is not an import.
const LEGACY_IMPORTS = [
  /^@\/primitives/, /components\/primitives/, /components\/ui\//, /design-system\/signals/,
  /design-system\/patterns/, /^@\/lib\/utils/, /currencyFormatter/, /metricDisplay/,
];
const FORBIDDEN_DEPENDENCIES = /^(three|@react-three|framer-motion|motion|gsap|lottie|@tsparticles)(\/|$)/;
const specifiers = (text) => [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);

/** Every violation of the source contract in one LUMI .js/.jsx file's text. */
export function auditSource(text) {
  const violations = [];
  if (/className="/.test(text) || /className=\{\s*[`'"]/.test(text)) violations.push('literal className (Tailwind or ad-hoc classes)');
  if (/\bstyle=\{/.test(text)) violations.push('inline style');
  if (/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/i.test(text.replace(/\/\/.*$/gm, ''))) violations.push('raw hex');
  for (const specifier of specifiers(text)) {
    for (const pattern of LEGACY_IMPORTS) if (pattern.test(specifier)) violations.push(`legacy import ${specifier}`);
    if (FORBIDDEN_DEPENDENCIES.test(specifier)) violations.push(`3D, animation or particle dependency ${specifier}`);
  }
  if (/style:\s*['"]currency['"]/.test(text)) violations.push('a second currency formatter');
  if (/function\s+formatCurrency|const\s+formatCurrency/.test(text)) violations.push('a second formatCurrency');
  if (/\banimate-|keyframes|requestAnimationFrame/.test(text)) violations.push('animation');
  return violations;
}

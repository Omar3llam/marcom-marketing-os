// ============================================================
// Measurement · Money
// ------------------------------------------------------------
// GRAMMAR OBJECT  MEASUREMENT, serving EVIDENCE (PRODUCT_GRAMMAR.md §10, §11 Metric)
// CONTRACT        `label`, `window` (or the enclosing EvidenceGroup's), optional
//                 `basis`, a `state`, and for a value state a `figure`:
//                   { number, fractionDigits, unit? }   a measured quantity
//                   { amountMinor, currency }           money, in minor units
// STATES          AVAILABLE · STALE · PARTIAL render the figure; LOADING · FAILED ·
//                 UNAVAILABLE · NOT_CONNECTED · NOT_PERMITTED · NOT_SUPPORTED ·
//                 NOT_MEASURED · INSUFFICIENT_DATA · NO_CONVERSIONS · MIXED_CURRENCY
//                 render the state's words and reason in the figure's slot.
// WHY LUMI        B8-01 L-6: a figure without its window does not appear.
//                 Article 28 / 🔒 PR-7: no figure is invented, and an absence is
//                 never drawn as 0. 🔒 PR-12: one money contract, no silent USD.
// MOTION          none — no count-up (MO-4 §3)
//
// MONEY uses the canonical client contract `formatCurrency(amountMinor, code)`
// from client/src/lib/money.ts, and adds no formatter of its own. It passes
// through none of that module's defaults: the locale is the UI language rather
// than a per-currency guess, the currency is required, a null
// currency is stated as not reported, and a code whose minor-unit exponent the
// canonical table does not declare is refused rather than formatted at an
// assumed exponent (the `/100` defect class).
// ============================================================
import { CURRENCY_MINOR_UNITS, formatCurrency } from '@/lib/money';
import { assertOneOf, assertProps, assertText, cx } from '../contract.js';
import { useGround } from '../primitives/Environment.jsx';
import { useEvidenceWindow } from './EvidenceGroup.jsx';
import { STATE_LABEL, stateKey } from './vocabulary.js';
import css from './grammar.module.css';

const VALUE_STATES = ['AVAILABLE', 'STALE', 'PARTIAL'];
const ABSENT_STATES = ['LOADING', 'FAILED', 'UNAVAILABLE', 'NOT_CONNECTED', 'NOT_PERMITTED', 'NOT_SUPPORTED',
  'NOT_MEASURED', 'INSUFFICIENT_DATA', 'NO_CONVERSIONS', 'MIXED_CURRENCY'];
const PROMINENCE = { headline: css.figureHeadline, inline: css.figureInline };

// The UI language (Constitution Article 20 §7: "The UI is English"). Passed to the
// canonical formatter's own locale parameter. Without it, money.ts picks a locale
// per currency (ar-KW, ar-EG …), which renders Arabic-Indic digits that JetBrains
// Mono does not contain — found in the Phase 3 visual review.
const MONEY_LOCALE = 'en-US';

export function Money(props) {
  assertProps('Money', props, ['amountMinor', 'currency']);
  const { amountMinor, currency } = props;
  useGround('Money');
  if (!Number.isSafeInteger(amountMinor)) {
    throw new Error('Money: amountMinor must be an integer number of minor units. An absent amount is a state, not Money.');
  }
  if (currency === null) {
    return <span className={css.moneyRefusal} data-lumi-money="currency-not-reported">Currency not reported</span>;
  }
  assertText('Money', 'currency', currency);
  if (!Object.hasOwn(CURRENCY_MINOR_UNITS, currency)) {
    return (
      <span className={css.moneyRefusal} data-lumi-money="currency-not-declared">
        {`${currency} amounts cannot be shown yet`}
      </span>
    );
  }
  return <span data-lumi-money="formatted">{formatCurrency(amountMinor, currency, MONEY_LOCALE)}</span>;
}

function Figure({ figure }) {
  if (figure && 'amountMinor' in figure) {
    assertProps('Measurement figure', figure, ['amountMinor', 'currency']);
    return <Money amountMinor={figure.amountMinor} currency={figure.currency} />;
  }
  if (!figure || typeof figure !== 'object') {
    throw new Error('Measurement: a value state needs a figure — { number, fractionDigits, unit? } or { amountMinor, currency }.');
  }
  assertProps('Measurement figure', figure, ['number', 'fractionDigits', 'unit']);
  const { number, fractionDigits, unit } = figure;
  if (!Number.isFinite(number)) throw new Error('Measurement: figure.number must be a finite number.');
  assertOneOf('Measurement', 'figure.fractionDigits', fractionDigits, [0, 1, 2, 3, 4]);
  if (unit !== undefined) assertText('Measurement', 'figure.unit', unit);
  const text = number.toLocaleString('en-US', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
  return <span>{unit ? `${text} ${unit}` : text}</span>;
}

export function Measurement(props) {
  assertProps('Measurement', props, ['label', 'window', 'basis', 'state', 'figure', 'reason', 'prominence']);
  const { label, window, basis, state, figure, reason, prominence = 'inline' } = props;
  useGround('Measurement');
  const groupWindow = useEvidenceWindow();
  assertText('Measurement', 'label', label);
  assertOneOf('Measurement', 'state', state, [...VALUE_STATES, ...ABSENT_STATES]);
  assertOneOf('Measurement', 'prominence', prominence, Object.keys(PROMINENCE));
  if (basis !== undefined) assertText('Measurement', 'basis', basis);

  const effectiveWindow = window ?? groupWindow;
  if (effectiveWindow === null || effectiveWindow === undefined) {
    throw new Error(`Measurement: "${label}" has no window. A figure without its window does not appear (B8-01 L-6).`);
  }
  assertText('Measurement', 'window', effectiveWindow);
  if (groupWindow !== null && window !== undefined && window !== groupWindow) {
    throw new Error(`Measurement: "${label}" is measured over "${window}", not its group's "${groupWindow}".`);
  }

  const isValue = VALUE_STATES.includes(state);
  if (isValue && figure === undefined) throw new Error(`Measurement: ${state} needs its figure.`);
  if (!isValue && figure !== undefined) {
    throw new Error(`Measurement: ${state} renders no figure. An absent value is its state, never a number.`);
  }
  if (state === 'AVAILABLE') {
    if (reason !== undefined) throw new Error('Measurement: an AVAILABLE figure takes no reason; a qualifier makes it PARTIAL or STALE.');
  } else if (state !== 'LOADING' || reason !== undefined) {
    assertText('Measurement', 'reason', reason);
  }

  const tone = css[`state${stateKey(state)}`];
  return (
    <div className={css.measurement} data-lumi-state={state} aria-busy={state === 'LOADING' ? 'true' : undefined}>
      <p className={css.measurementLabel}>{label}</p>
      <p className={isValue ? cx(css.figure, PROMINENCE[prominence]) : cx(css.stateLabel, tone)} data-lumi-slot="value">
        {isValue ? <Figure figure={figure} /> : STATE_LABEL[state]}
      </p>
      {state !== 'AVAILABLE' && isValue && <p className={cx(css.stateLabel, tone)}>{STATE_LABEL[state]}</p>}
      {reason !== undefined && <p className={css.bodyText}>{reason}</p>}
      <p className={css.metaText}>{basis ? `${effectiveWindow} · ${basis}` : effectiveWindow}</p>
    </div>
  );
}

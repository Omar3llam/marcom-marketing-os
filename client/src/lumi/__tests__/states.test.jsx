// Phase 3 — state semantics: ClaimState, Measurement, EvidenceGroup, Money.
import fs from 'node:fs';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { formatCurrency } from '@/lib/money';
import { localDir } from '../../../design-system/foundation/resolve.js';
import { Button, CLAIM_STATES, ClaimState, EvidenceGroup, Measurement, Money } from '../index.js';
import { DECISION_STATUSES, STATE_CLASS, STATE_LABEL, STATES, VERDICTS } from '../grammar/vocabulary.js';
import { expectRefused, quietRenderErrors, renderIn } from './helpers.jsx';

const semantic = JSON.parse(fs.readFileSync(localDir('../../../design-system/foundation/tokens/semantic.json', import.meta.url), 'utf8'));
const camel = (state) => state.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());

const REQUIRED_VALUE = ['AVAILABLE', 'STALE', 'PARTIAL'];
const render16 = (state) => {
  const value = REQUIRED_VALUE.includes(state) ? <span>value</span> : undefined;
  const reason = state === 'AVAILABLE' ? undefined : `reason for ${state}`;
  return renderIn(<ClaimState state={state} claim="Spend over the verdict window" reason={reason}>{value}</ClaimState>);
};

describe('the state registry is the locked vocabulary, in both directions', () => {
  it('equals semantic.json $states, name for name and class for class', () => {
    const declared = Object.fromEntries(
      Object.entries(semantic.$states).filter(([k]) => !k.startsWith('$')).map(([k, v]) => [k, v.illumination]),
    );
    const mine = Object.fromEntries(Object.entries(STATE_CLASS).map(([k, v]) => [camel(k), v]));
    expect(mine).toEqual(declared);
    expect(STATES).toHaveLength(17);
  });

  it('gives every state distinct words', () => {
    expect(Object.keys(STATE_LABEL)).toEqual(STATES);
    expect(new Set(Object.values(STATE_LABEL)).size).toBe(17);
  });

  it('expresses 16 states through ClaimState and DISABLED through a control', () => {
    expect(CLAIM_STATES).toHaveLength(16);
    expect(CLAIM_STATES).not.toContain('DISABLED');
    renderIn(<Button prominence="standard" onActivate={() => {}} disabledReason="Your role cannot pause campaigns.">Pause</Button>);
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveAccessibleDescription('Your role cannot pause campaigns.');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Phase 5.4 — the verdict and status lists are declared in vocabulary.js
// instead of read off the parse layer, because that import pulled the whole
// zod runtime onto the public landing. Declaring them is only safe while THIS
// holds: the parse layer stays the authority, and any divergence fails here.
// ════════════════════════════════════════════════════════════════════════════
describe('the declared verdict vocabulary equals the parse layer, in both directions', () => {
  it('is exactly VerdictSchema.options, same members and same order', async () => {
    const { VerdictSchema } = await import('@/contracts/schemas/decision.schema');
    const canonical = [...VerdictSchema.options];
    expect([...VERDICTS]).toEqual(canonical);                       // nothing missing, nothing reordered
    expect(canonical.every((v) => VERDICTS.includes(v))).toBe(true); // …and nothing only in the contract
    expect(VERDICTS.every((v) => canonical.includes(v))).toBe(true); // …and nothing only here
    expect(VERDICTS).toHaveLength(canonical.length);
  });

  it('is exactly DecisionStatusSchema.options, same members and same order', async () => {
    const { DecisionStatusSchema } = await import('@/contracts/schemas/decision.schema');
    const canonical = [...DecisionStatusSchema.options];
    expect([...DECISION_STATUSES]).toEqual(canonical);
    expect(canonical.every((v) => DECISION_STATUSES.includes(v))).toBe(true);
    expect(DECISION_STATUSES.every((v) => canonical.includes(v))).toBe(true);
    expect(DECISION_STATUSES).toHaveLength(canonical.length);
  });

  // The equality above is worth nothing if the import quietly comes back: the
  // landing would ship zod again and every assertion here would still pass.
  it('keeps the schema edge severed — vocabulary.js imports no parse-layer module', () => {
    const source = fs.readFileSync(localDir('../grammar/vocabulary.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from\s+'@\/contracts\//);
    expect(source).not.toMatch(/from\s+'zod'/);
    expect(source).toMatch(/@marcom\/runtime-contracts/); // this one is plain data, and stays
  });
});

describe('ClaimState', () => {
  quietRenderErrors();

  it.each(CLAIM_STATES)('renders %s with its own words and the claim it describes', (state) => {
    const { container } = render16(state);
    const root = container.querySelector(`[data-lumi-state="${state}"]`);
    expect(root).toHaveTextContent('Spend over the verdict window');
    if (state !== 'AVAILABLE') expect(root).toHaveTextContent(STATE_LABEL[state]);
  });

  it('keeps the pairs the spec separates visibly different', () => {
    const pairs = [['FAILED', 'EMPTY'], ['EMPTY', 'AVAILABLE'], ['UNAVAILABLE', 'EMPTY'], ['NOT_CONNECTED', 'FAILED'],
      ['PARTIAL', 'FAILED'], ['NOT_SUPPORTED', 'UNAVAILABLE'], ['NOT_PERMITTED', 'NOT_SUPPORTED']];
    for (const [a, b] of pairs) {
      const textA = render16(a).container.textContent;
      const textB = render16(b).container.textContent;
      expect(textA).not.toBe(textB);
    }
  });

  it('never renders a value beside an absence: no zero, no dash', () => {
    for (const state of ['NOT_MEASURED', 'FAILED', 'EMPTY', 'UNAVAILABLE', 'NO_CONVERSIONS', 'MIXED_CURRENCY']) {
      expectRefused(<ClaimState state={state} claim="CPA" reason="r">0</ClaimState>, /renders no value beside it/);
      expectRefused(<ClaimState state={state} claim="CPA" reason="r">—</ClaimState>, /renders no value beside it/);
    }
  });

  it('requires the value for AVAILABLE, STALE and PARTIAL, and a reason for every qualified state', () => {
    expectRefused(<ClaimState state="AVAILABLE" claim="Spend" />, /renders the value itself/);
    expectRefused(<ClaimState state="AVAILABLE" claim="Spend" reason="because">v</ClaimState>, /speaks for itself/);
    expectRefused(<ClaimState state="STALE" claim="Spend">v</ClaimState>, /reason must be non-empty/);
    expectRefused(<ClaimState state="FAILED" claim="Spend" />, /reason must be non-empty/);
    expectRefused(<ClaimState state="EMPTY" claim="" reason="r" />, /claim must be non-empty/);
  });

  it('marks LOADING busy without any placeholder figure', () => {
    const { container } = renderIn(<ClaimState state="LOADING" claim="Open decisions" />);
    const root = container.querySelector('[data-lumi-state="LOADING"]');
    expect(root).toHaveAttribute('aria-busy', 'true');
    expect(root.textContent).not.toMatch(/\d/);
  });

  it('announces PROCESSING and SUCCESS, and not a failure read in place', () => {
    renderIn(<ClaimState state="PROCESSING" claim="Pause campaign" reason="Executing on Meta" />);
    expect(screen.getByRole('status')).toHaveTextContent('Executing on Meta');
    const { container } = renderIn(<ClaimState state="FAILED" claim="Decisions" reason="The decisions list could not be read." />);
    expect(container.querySelector('[data-lumi-state="FAILED"]')).not.toHaveAttribute('role');
  });

  it('accepts an instruction only where STATE_RULES permits one', () => {
    const onActivate = vi.fn();
    renderIn(<ClaimState state="FAILED" claim="Decisions" reason="Could not be read." remedy={{ label: 'Try again', onActivate }} />);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    for (const state of ['NOT_SUPPORTED', 'NOT_MEASURED', 'INSUFFICIENT_DATA', 'MIXED_CURRENCY', 'PROCESSING', 'SUCCESS', 'LOADING']) {
      expectRefused(<ClaimState state={state} claim="x" reason="r" remedy={{ label: 'Connect', onActivate }} />, /carries no instruction/);
    }
  });

  it('names the plan on a plan lock and keeps the lock structural', () => {
    renderIn(<ClaimState state="NOT_PERMITTED" claim="Memory" reason="Memory is part of the Growth plan." requiredPlan="GROWTH" />);
    expect(screen.getByText(/Requires GROWTH/)).toBeInTheDocument();
    expectRefused(<ClaimState state="NOT_SUPPORTED" claim="Memory" reason="r" requiredPlan="GROWTH" />, /NOT_PERMITTED only/);
    expectRefused(<ClaimState state="DISABLED" claim="x" reason="r" />, /interaction state/);
  });
});

describe('Measurement — a figure with its window, or its state', () => {
  quietRenderErrors();
  const window = 'Last 7 days · UTC';

  it('renders a figure with its window and basis at the requested prominence', () => {
    const { container } = renderIn(<Measurement label="Impressions" window={window} basis="Meta, campaign" state="AVAILABLE" prominence="headline" figure={{ number: 1234567, fractionDigits: 0 }} />);
    expect(container.querySelector('[data-lumi-slot="value"]')).toHaveTextContent('1,234,567');
    expect(container).toHaveTextContent('Last 7 days · UTC · Meta, campaign');
  });

  it('formats a number only at the precision the consumer declares', () => {
    const { container } = renderIn(<Measurement label="ROAS" window={window} state="AVAILABLE" figure={{ number: 4.2, fractionDigits: 2, unit: 'x' }} />);
    expect(container.querySelector('[data-lumi-slot="value"]').textContent).toBe('4.20 x');
    expectRefused(<Measurement label="ROAS" window={window} state="AVAILABLE" figure={{ number: 4.2 }} />, /fractionDigits/);
    expectRefused(<Measurement label="ROAS" window={window} state="AVAILABLE" figure={{ number: Number.NaN, fractionDigits: 2 }} />, /finite number/);
  });

  it('refuses a figure without a window', () => {
    expectRefused(<Measurement label="Spend" state="AVAILABLE" figure={{ number: 1, fractionDigits: 0 }} />, /has no window/);
  });

  it('refuses a number beside an absence, zero included', () => {
    expectRefused(<Measurement label="CPA" window={window} state="NOT_MEASURED" reason="No contributing row reported conversions." figure={{ number: 0, fractionDigits: 2 }} />, /renders no figure/);
    expectRefused(<Measurement label="Spend" window={window} state="AVAILABLE" />, /needs its figure/);
  });

  it.each(['NOT_MEASURED', 'NO_CONVERSIONS', 'MIXED_CURRENCY', 'UNAVAILABLE', 'FAILED', 'NOT_PERMITTED', 'INSUFFICIENT_DATA', 'NOT_CONNECTED', 'NOT_SUPPORTED'])(
    'keeps the label and window for %s and puts no digit in the value slot',
    (state) => {
      const { container } = renderIn(<Measurement label="CPA" window={window} state={state} reason="The reason the backend published." />);
      const slot = container.querySelector('[data-lumi-slot="value"]');
      expect(slot).toHaveTextContent(STATE_LABEL[state]);
      expect(slot.textContent).not.toMatch(/\d/);
      expect(container).toHaveTextContent('CPA');
      expect(container).toHaveTextContent(window);
    },
  );

  it('states STALE and PARTIAL beside the value, never instead of it', () => {
    const { container } = renderIn(<Measurement label="Spend" window={window} state="STALE" reason="Last synced 3 days ago." figure={{ number: 10, fractionDigits: 0 }} />);
    expect(container.querySelector('[data-lumi-slot="value"]')).toHaveTextContent('10');
    expect(container).toHaveTextContent('Stale');
    expect(container).toHaveTextContent('Last synced 3 days ago.');
  });
});

describe('EvidenceGroup — one population, one window', () => {
  quietRenderErrors();

  it('lends its window to its measurements', () => {
    renderIn(
      <EvidenceGroup question="Is it working?" headingLevel={3} population="Campaign cmp_1" window="Last 7 days · UTC" source="Meta">
        <Measurement label="Clicks" state="AVAILABLE" figure={{ number: 42, fractionDigits: 0 }} />
      </EvidenceGroup>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Is it working?' })).toBeInTheDocument();
    expect(screen.getAllByText(/Last 7 days · UTC/)).toHaveLength(2);
  });

  it('refuses a measurement over a different window, and a group with nothing in it', () => {
    expectRefused(
      <EvidenceGroup question="Is it working?" headingLevel={3} population="Campaign" window="Last 7 days · UTC" source="Meta">
        <Measurement label="Clicks" window="Last 30 days · UTC" state="AVAILABLE" figure={{ number: 42, fractionDigits: 0 }} />
      </EvidenceGroup>,
      /not its group's/,
    );
    expectRefused(<EvidenceGroup question="q" headingLevel={3} population="p" window="w" source="s" />, /not evidence/);
  });
});

describe('Money — the canonical contract, with none of its defaults', () => {
  quietRenderErrors();

  it.each([[123456, 'USD'], [150000, 'KWD'], [5000, 'JPY'], [500000, 'EGP']])('formats %i minor %s exactly as money.ts does, in the UI language', (amountMinor, currency) => {
    const { container } = renderIn(<Money amountMinor={amountMinor} currency={currency} />);
    expect(container.textContent).toBe(formatCurrency(amountMinor, currency, 'en-US'));
    // Arabic-Indic digits (U+0660–U+0669) are not in JetBrains Mono (visual review finding V-1).
    expect(container.textContent).not.toMatch(/[٠-٩۰-۹]/);
  });

  it('never defaults to USD, and states an unreported currency instead of a figure', () => {
    expectRefused(<Money amountMinor={100} />, /currency must be non-empty/);
    const { container } = renderIn(<Money amountMinor={100} currency={null} />);
    expect(container.textContent).toBe('Currency not reported');
  });

  it('refuses to guess a minor-unit exponent the canonical table does not declare', () => {
    for (const currency of ['CHF', 'usd']) {
      const { container } = renderIn(<Money amountMinor={100} currency={currency} />);
      expect(container.querySelector('[data-lumi-money="currency-not-declared"]')).not.toBeNull();
      expect(container.textContent).not.toMatch(/\d/);
    }
  });

  it('refuses an amount that is not integer minor units, or absent', () => {
    expectRefused(<Money amountMinor={12.5} currency="USD" />, /integer number of minor units/);
    expectRefused(<Money amountMinor={null} currency="USD" />, /absent amount is a state/);
  });

  it('is what a money figure renders inside a Measurement', () => {
    const { container } = renderIn(<Measurement label="Spend" window="Last 7 days · UTC" state="AVAILABLE" figure={{ amountMinor: 150000, currency: 'KWD' }} />);
    expect(container.querySelector('[data-lumi-slot="value"]').textContent).toBe(formatCurrency(150000, 'KWD', 'en-US'));
  });
});

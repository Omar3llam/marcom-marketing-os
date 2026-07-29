// ============================================================
// LearningInsight — the workspace's own track record
// ------------------------------------------------------------
// The copy is the product here. It must claim correlation ("improved after"),
// name its source ("in your workspace"), and never present itself as a model's
// opinion — it is arithmetic over rows the user's own account produced.
//
// And it must stay silent when the sample cannot support a claim: "0 of 2" reads
// as evidence to anyone who sees it.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LearningInsight } from './LearningInsight.jsx';

const tally = (over = {}) => ({
  total: 12, improved: 9, unchanged: 2, worsened: 1, unscored: 0, confidence: 0.75, ...over,
});

const setup = (learning) => render(<LearningInsight learning={learning} />);

describe('renders nothing without a defensible sample', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a sample below the floor', tally({ total: 2, improved: 1 })],
    ['nothing improved', tally({ total: 5, improved: 0 })],
  ])('%s', (_label, learning) => {
    const { container } = setup(learning);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the claim', () => {
  it('states the fraction and what it means', () => {
    setup(tally());
    expect(screen.getByText('9 of 12')).toBeInTheDocument();
    expect(screen.getByText(/similar decisions improved after action\./)).toBeInTheDocument();
  });

  it('names its source as the workspace, not a benchmark', () => {
    setup(tally());
    expect(screen.getByText('Based on outcomes from similar decisions in your workspace.')).toBeInTheDocument();
  });

  // "improved AFTER action" is correlational. Nothing here shows the action
  // caused the change, and the copy must never imply it did.
  it('claims correlation, never causation', () => {
    const { container } = setup(tally());
    expect(container.textContent).toMatch(/improved after action/i);
    expect(container.textContent).not.toMatch(/because|caused|thanks to|result of/i);
  });

  // This is arithmetic over the user's own rows. Dressing it as a machine's
  // belief would be less trustworthy AND less true.
  it('never presents itself as an AI opinion', () => {
    const { container } = setup(tally());
    expect(container.textContent).not.toMatch(/\bAI\b|Lumi thinks|Claude|model|predict|confidence score/i);
  });

  it('renders at exactly the floor', () => {
    setup(tally({ total: 3, improved: 1, unchanged: 1, worsened: 1 }));
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });
});

describe('the unscoreable remainder', () => {
  // Without this line "9 of 12" reads as "12 is everything we have" when it is
  // twelve of fifteen.
  it('says how many could not be measured', () => {
    setup(tally({ unscored: 3 }));
    expect(screen.getByText(/3 more couldn't be measured and are not counted\./)).toBeInTheDocument();
  });

  it('singularises one', () => {
    setup(tally({ unscored: 1 }));
    expect(screen.getByText(/1 more couldn't be measured and is not counted\./)).toBeInTheDocument();
  });

  it('says nothing when everything was measured', () => {
    setup(tally({ unscored: 0 }));
    expect(screen.queryByText(/couldn't be measured/)).not.toBeInTheDocument();
  });

  it('tolerates an absent unscored field', () => {
    const { unscored, ...withoutUnscored } = tally();
    setup(withoutUnscored);
    expect(screen.getByText('9 of 12')).toBeInTheDocument();
    expect(screen.queryByText(/couldn't be measured/)).not.toBeInTheDocument();
  });
});

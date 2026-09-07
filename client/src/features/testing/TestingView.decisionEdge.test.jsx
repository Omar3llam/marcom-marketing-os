// ============================================================
// B8-05 · E6 forward edge — the experiment holds the id, so it must use it
// ------------------------------------------------------------
// A concluded experiment that produced a verdict carries `decisionId` — the
// exact identity of the Decision it created. On `d60c12f` the card threw that
// id away and named a page instead:
//
//     {exp.decisionId && (
//       <Link to={appRoutes.overview}>Lumi proposed an action — review on Overview →</Link>
//     )}
//
// Overview is Attention: `feed.js:91` selects `status: 'PROPOSED'`. So the
// sentence is true for exactly as long as nobody acts. The moment the decision
// is executed, dismissed, or superseded by a later sweep, it leaves Overview
// and the card still promises a review that page cannot deliver.
//
// This is B8-01's forbidden inference — a verb from a capability the
// destination lacks — and it stopped being necessary when B8-04 landed
// `/app/decisions/:id`, which admits all five DecisionStatus values (B8-01
// widened the enum precisely so a closed decision survives the parse).
//
// DEFERRED, DELIBERATELY: the edge the other way. A Decision knows which
// experiment produced it only as `rootCause = "test:<id>"`, a prefixed free-text
// string. Parsing it here would promote an incidental encoding into a
// navigation contract — see `lumi_b8_05_experiment_surfaces` and the B8-05 PR
// body. Slice 5 ships the forward edge only.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TestingView } from './TestingView.jsx';

const concluded = (over = {}) => ({
  id: 't1', status: 'CONCLUDED', dimension: 'HOOK', metric: 'CTR',
  hypothesis: 'Static beats video',
  winnerLabel: 'Variant B', lift: 12, confidenceLabel: 'HIGH',
  decisionId: 'd-99',
  variants: [
    { id: 'a', label: 'Control', isControl: true, impressions: 2000, clicks: 40, conversions: 4 },
    { id: 'b', label: 'Variant B', isControl: false, impressions: 2000, clicks: 60, conversions: 6, isWinner: true },
  ],
  ...over,
});

const renderView = (experiments) => render(
  <MemoryRouter><TestingView experiments={experiments} role="BUYER" /></MemoryRouter>,
);

describe('B8-05 · E6 — the link goes to the decision, not to a page that may not hold it', () => {
  it('points at /app/decisions/<that id>', () => {
    renderView([concluded()]);
    const link = screen.getByRole('link', { name: /decision/i });
    expect(link).toHaveAttribute('href', '/app/decisions/d-99');
  });

  it('no longer sends the reader to Overview', () => {
    const { container } = renderView([concluded()]);
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).not.toContain('/app/overview');
  });

  it('says nothing about where the decision currently sits', () => {
    // The old copy asserted a location ("review on Overview"). A decision's
    // presence in Attention depends on its status, which this card does not
    // know — so the link may name the decision, never its whereabouts.
    const { container } = renderView([concluded()]);
    expect(container.textContent).not.toMatch(/on Overview/i);
  });

  it('an experiment with no decision offers no link at all', () => {
    // Absence of a verdict is a real outcome: a concluded test that produced no
    // governance-valid action. It must not render a dead or invented target.
    const { container } = renderView([concluded({ decisionId: null })]);
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs.filter((h) => h?.startsWith('/app/decisions/'))).toHaveLength(0);
  });
});

describe('B8-05 · R-E4 — the list stops printing a finding as a band', () => {
  it('INCONCLUSIVE reads as a finding, not as a level of confidence', () => {
    renderView([concluded({ winnerLabel: null, lift: null, confidenceLabel: 'INCONCLUSIVE' })]);
    expect(screen.queryByText(/INCONCLUSIVE confidence/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no call could be made/i)).toBeInTheDocument();
  });

  it('a null label says the same thing as INCONCLUSIVE', () => {
    // The holdout half stores null where the A/B half stores the word. A reader
    // must not have to learn which producer wrote the row.
    renderView([concluded({ winnerLabel: null, lift: null, confidenceLabel: null })]);
    expect(screen.getByText(/no call could be made/i)).toBeInTheDocument();
  });

  it('MODERATE is presented as the MEDIUM rung', () => {
    renderView([concluded({ confidenceLabel: 'MODERATE' })]);
    expect(screen.getByText(/medium confidence/i)).toBeInTheDocument();
  });

  it('an unrecognised label is not dressed as an inconclusive result', () => {
    // `CONF_STYLE[label] || CONF_STYLE.INCONCLUSIVE` made drift look like a
    // legitimate finding. Drift is a fact about our contract, not about the test.
    renderView([concluded({ confidenceLabel: 'VERY_HIGH' })]);
    expect(screen.queryByText(/no call could be made/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/VERY_HIGH confidence/i)).not.toBeInTheDocument();
  });
});

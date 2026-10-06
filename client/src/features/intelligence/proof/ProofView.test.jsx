// Proof-specific evidence: published membership and cohort status remain
// separate from the AccountLift headline. No continuous geometry.
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ProofView } from './ProofView.jsx';

const headline = "Lumi's calls: calibration error 8% — improving";
const surface = { gated: false, headline, status: 'IMPROVING', improvementPct: 20 };
const calibration = {
  expectedCalibrationError: 0.08, brierScore: 0.1, direction: 'OVERCONFIDENT', accuracy: 0.72,
  sampleSize: 26, populationSpan: { basis: 'DECISION_ISSUED_AT', from: '2026-01-03T10:00:00.000Z', to: '2026-04-20T18:00:00.000Z' },
  bins: [{ band: '80-90%', predicted: 0.85, observed: 0.79, count: 26 }],
};
const period = (label, calibrationError, sampleSize, includedInTrend) =>
  ({ label, calibrationError, sampleSize, includedInTrend });
const cohortName = 'Calibration by decision cohort';
function renderProof(velocity, overrides = {}) {
  return render(<ProofView role="STRATEGIST" surface={surface}
    data={{ calibration, velocity, coverage: { verdict: 'RELIABLE' } }} {...overrides} />);
}
function cohorts() { return screen.getByRole('region', { name: cohortName }); }
function row(label) { return within(cohorts()).getByText(label).closest('li'); }

describe('Proof cohort evidence replaces continuous geometry', () => {
  it('shows an excluded outlier beside a steady fit without a line or invented exclusion reason', () => {
    renderProof({ trend: 'FLAT', slope: 0, periods: [
      period('2026-01', 0.9, 2, false), period('2026-03', 0.1, 30, true), period('2026-06', 0.1, 30, true),
    ] });
    const section = cohorts();
    expect(within(section).getByText('Steady')).toBeInTheDocument();
    expect(row('2026-01')).toHaveTextContent('90%');
    expect(row('2026-01')).toHaveTextContent('n=2');
    expect(row('2026-01')).toHaveTextContent('Not used in trend');
    expect(row('2026-03')).toHaveTextContent('Used in trend');
    expect(row('2026-06')).toHaveTextContent('Used in trend');
    expect(section.querySelector('svg, polyline, canvas')).toBeNull();
    expect(section).not.toHaveTextContent(/insufficient sample|too few decisions|invalid ECE|below threshold/i);
    expect(section).toHaveTextContent('UTC issuance month');
    expect(section).toHaveTextContent('Lower is better');
    expect(section).toHaveTextContent("selected by Lumi's calibration engine");
    expect(section).toHaveTextContent('Cohort values can update as outcomes mature');
    expect(screen.queryByText('Learning velocity')).not.toBeInTheDocument();
  });
  it.each([1, 0])('keeps all evidence with %s included periods and insufficient fit', (included) => {
    renderProof({ trend: 'INSUFFICIENT_DATA', slope: null, periods: [
      period('2026-01', 0.1, 30, included === 1), period('2026-03', 0.2, 2, false), period('2026-06', null, 0, false),
    ] });
    expect(within(cohorts()).getByText('Still learning')).toBeInTheDocument();
    expect(within(cohorts()).getAllByRole('listitem')).toHaveLength(3);
    expect(row('2026-06')).toHaveTextContent('Calibration error: —');
    expect(row('2026-06')).not.toHaveTextContent('0%');
    expect(within(cohorts()).getAllByText('Not used in trend')).toHaveLength(3 - included);
    expect(cohorts().querySelector('svg, polyline')).toBeNull();
  });
  it('reads membership directly rather than guessing from sample count', () => {
    renderProof({ trend: 'FLAT', periods: [
      period('selected', 0.1, 2, true), period('excluded', 0.2, 100, false),
    ] });
    expect(row('selected')).toHaveTextContent('Used in trend');
    expect(row('excluded')).toHaveTextContent('Not used in trend');
  });
  it('retains exactly server order and labels, without synthesizing missing months', () => {
    renderProof({ trend: 'IMPROVING', periods: [
      period('2026-06', 0.1, 40, true), period('2026-01', 0.2, 40, true), period('2026-03', 0.15, 40, true),
    ] });
    expect(within(cohorts()).getAllByRole('listitem').map((item) =>
      item.querySelector('span').textContent)).toEqual(['2026-06', '2026-01', '2026-03']);
    expect(cohorts()).not.toHaveTextContent(/2026-02|2026-04|2026-05/);
    expect(cohorts().querySelector('polyline')).toBeNull();
  });
  it.each([0.11, 0.4])('distinguishes a recent value of %s from 10 percent without auto-scaled movement', (recent) => {
    renderProof({ trend: 'DEGRADING', periods: [
      period('first', 0.1, 40, true), period('recent', recent, 40, true),
    ] });
    expect(row('first')).toHaveTextContent('10%');
    expect(row('recent')).toHaveTextContent(recent === 0.11 ? '11%' : '40%');
    expect(cohorts().querySelector('svg, polyline, canvas')).toBeNull();
  });
  it.each([
    ['IMPROVING', 0.104, 0.096, 'Improving', '10%'],
    ['FLAT', 0.1, 0.11, 'Steady', '11%'],
  ])('uses server %s even when rounding suggests another direction', (trend, early, recent, label, displayed) => {
    renderProof({ trend, periods: [period('first', early, 40, true), period('recent', recent, 40, true)] });
    expect(within(cohorts()).getByText(label)).toBeInTheDocument();
    expect(row('recent')).toHaveTextContent(displayed);
    if (trend === 'IMPROVING') expect(row('first')).toHaveTextContent('10%');
  });
  it.each([
    ['IMPROVING', 'Improving'], ['FLAT', 'Steady'],
    ['DEGRADING', 'Degrading'], ['INSUFFICIENT_DATA', 'Still learning'],
  ])('presents %s neutrally without campaign-verdict colors', (trend, label) => {
    renderProof({ trend, periods: [period('2026-01', 0.1, 40, true)] });
    expect(within(cohorts()).getByText(label)).toBeInTheDocument();
    expect(cohorts().querySelector('[class*="signal-scale"], [class*="signal-hold"], [class*="signal-kill"]')).toBeNull();
  });
  it('does not promote an unknown direct-prop status to a healthy or insufficient classification', () => {
    renderProof({ trend: 'FUTURE_STATUS', periods: [period('2026-01', 0.1, 40, true)] });
    expect(within(cohorts()).getByText('Trend unavailable')).toBeInTheDocument();
  });
  it('keeps the AccountLift headline and cohort classification separate', () => {
    renderProof({ trend: 'FLAT', slope: 0, periods: [period('2026-01', 0.1, 40, true)] });
    expect(screen.getByText(headline)).toBeInTheDocument();
    expect(cohorts()).toHaveTextContent('Cohort trend: Steady');
    expect(cohorts()).not.toHaveTextContent(headline);
  });
  it.each([6, 12, 24, 60])('keeps all %s cohorts accessible with values, counts and membership', (count) => {
    const periods = Array.from({ length: count }, (_, i) =>
      period(`cohort-${i + 1}`, 0.1, i + 30, i % 2 === 0));
    renderProof({ trend: 'FLAT', periods });
    expect(within(cohorts()).getAllByRole('listitem')).toHaveLength(count);
    for (const item of periods) {
      expect(row(item.label)).toHaveTextContent('10%');
      expect(row(item.label)).toHaveTextContent(`n=${item.sampleSize}`);
      expect(row(item.label)).toHaveTextContent(item.includedInTrend ? 'Used in trend' : 'Not used in trend');
    }
    expect(cohorts()).not.toHaveTextContent(/show more|last 6|last 12|…/i);
  });
  it('keeps no-history behavior for an empty published array', () => {
    renderProof({ trend: 'INSUFFICIENT_DATA', periods: [] });
    expect(screen.queryByRole('region', { name: cohortName })).not.toBeInTheDocument();
    expect(screen.getByText(headline)).toBeInTheDocument();
  });
});

describe('Proof numeric evidence never invents measured zero', () => {
  it('keeps a missing cohort measurement distinct from measured zero through direct props', () => {
    const { container } = renderProof({ trend: 'INSUFFICIENT_DATA', periods: [period('missing', null, 0, false)] }, {
      data: { calibration: { ...calibration, bins: [] }, coverage: { verdict: 'RELIABLE' },
        velocity: { trend: 'INSUFFICIENT_DATA', periods: [period('missing', null, 0, false)] } },
    });
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(container).toHaveTextContent('Calibration error: —');
  });
  it.each([null, undefined, NaN, Infinity, -Infinity])('renders unavailable for aggregate ECE/accuracy %s', (missing) => {
    const { container } = renderProof({ trend: 'INSUFFICIENT_DATA', periods: [] }, {
      data: { calibration: { ...calibration, expectedCalibrationError: missing, accuracy: missing },
        velocity: { periods: [] }, coverage: { verdict: 'RELIABLE' } },
    });
    expect(container.textContent).toMatch(/Calibration error \(ECE\).*: —/);
    expect(container).toHaveTextContent('Accuracy (secondary): —');
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(container).toHaveTextContent('Brier: 0.10');
  });
  it('keeps measured zero as 0% for aggregate and cohort evidence', () => {
    renderProof(null, {
      data: { calibration: { ...calibration, expectedCalibrationError: 0, accuracy: 0, brierScore: 0, bins: [] },
        velocity: { trend: 'FLAT', periods: [period('zero', 0, 30, true)] }, coverage: { verdict: 'RELIABLE' } },
    });
    expect(row('zero')).toHaveTextContent('Calibration error: 0%');
    expect(screen.getByText('Accuracy (secondary): 0%')).toBeInTheDocument();
    expect(screen.getByText('Brier:').parentElement).toHaveTextContent('Brier: 0.00');
    expect(screen.getAllByText('0%')).toHaveLength(2);
  });
});

describe('Proof roles and hard coverage gate', () => {
  const velocity = { trend: 'IMPROVING', periods: [period('private-cohort', 0.6, 40, true)] };
  it.each(['THIN', 'INSUFFICIENT_DATA'])('suppresses details for %s even with periods', (verdict) => {
    renderProof(velocity, { data: { calibration, velocity, coverage: { verdict } },
      surface: { ...surface, gated: true, headline: 'Still learning this account' } });
    expect(screen.queryByRole('region', { name: cohortName })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText(/Calibration error \(ECE\)|Accuracy \(secondary\)/)).not.toBeInTheDocument();
    expect(screen.queryByText('60%')).not.toBeInTheDocument();
  });
  it('honors a gated surface even when core coverage says RELIABLE', () => {
    renderProof(velocity, { surface: { ...surface, gated: true, headline: 'Withheld calibration' } });
    expect(screen.queryByRole('region', { name: cohortName })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it.each(['BUYER', 'CLIENT'])('does not expand %s into cohort/reliability evidence', (role) => {
    renderProof(velocity, { role });
    expect(screen.getByText(headline)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: cohortName })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    if (role === 'CLIENT') expect(screen.queryByText(/Brier/)).not.toBeInTheDocument();
    else expect(screen.getByText(/Brier/)).toBeInTheDocument();
  });
  it('retains detailed calibration and reliability for a reliable STRATEGIST', () => {
    renderProof(velocity);
    expect(cohorts()).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('Confidence band');
  });
});

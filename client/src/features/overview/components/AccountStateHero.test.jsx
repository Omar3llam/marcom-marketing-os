// ============================================================
// AccountStateHero — the page's only h1
// ------------------------------------------------------------
// The number in the headline is the TRUE total, not the number of cards on
// screen. Quoting the visible count would under-report the account every time a
// band is capped.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AccountStateHero from './AccountStateHero.jsx';
import { ACCOUNT_STATE } from '../overviewState.js';

const setup = (props = {}) => render(
  <AccountStateHero state={ACCOUNT_STATE.LEARNING} {...props} />,
);

describe('per-state headline', () => {
  it('ACTION_REQUIRED counts the decisions', () => {
    setup({ state: ACCOUNT_STATE.ACTION_REQUIRED, actNowTotal: 2 });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('2 decisions need your attention.');
    expect(screen.getByText('Needs your call')).toBeInTheDocument();
  });

  it('WATCH_CLOSELY counts the campaigns', () => {
    setup({ state: ACCOUNT_STATE.WATCH_CLOSELY, watchTotal: 4 });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('4 campaigns need monitoring.');
    expect(screen.getByText('Keep watching')).toBeInTheDocument();
  });

  it('PERFORMING_WELL claims no number it would have to back up', () => {
    setup({ state: ACCOUNT_STATE.PERFORMING_WELL });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Everything is running smoothly today.');
    expect(screen.getByText('Running smoothly')).toBeInTheDocument();
  });

  it('LEARNING says it is still building, not that all is well', () => {
    setup({ state: ACCOUNT_STATE.LEARNING });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Building confidence in this workspace.');
    expect(screen.getByText('Building confidence')).toBeInTheDocument();
  });
});

describe('singular / plural', () => {
  it('1 decision needs (not need)', () => {
    setup({ state: ACCOUNT_STATE.ACTION_REQUIRED, actNowTotal: 1 });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('1 decision needs your attention.');
  });

  it('1 campaign needs monitoring', () => {
    setup({ state: ACCOUNT_STATE.WATCH_CLOSELY, watchTotal: 1 });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('1 campaign needs monitoring.');
  });
});

describe('honest absence', () => {
  it('state=null (loading) renders nothing — no flashed claim', () => {
    const { container } = render(<AccountStateHero state={null} actNowTotal={9} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('no workspace and no currency → the provenance line is omitted, never blank', () => {
    const { container } = render(
      <AccountStateHero state={ACCOUNT_STATE.PERFORMING_WELL} workspace={null} currency={null} />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect([...container.querySelectorAll('p')].some((p) => p.textContent.trim() === '')).toBe(false);
  });

  it('renders the workspace name when there is one', () => {
    setup({ state: ACCOUNT_STATE.PERFORMING_WELL, workspace: { name: 'Acme Co' } });
    expect(screen.getByText('Acme Co')).toBeInTheDocument();
  });

  it('renders the currency alongside the workspace, so the unit has a source', () => {
    setup({ state: ACCOUNT_STATE.PERFORMING_WELL, workspace: { name: 'Acme Co' }, currency: 'EGP' });
    expect(screen.getByText('Acme Co · EGP')).toBeInTheDocument();
  });

  it('a currency with no workspace renders without a stray separator', () => {
    setup({ state: ACCOUNT_STATE.PERFORMING_WELL, workspace: null, currency: 'EGP' });
    expect(screen.getByText('EGP')).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });
});

// ── PR#300: the money line ──────────────────────────────────
describe('money at risk', () => {
  const actionable = (over = {}) => setup({
    state: ACCOUNT_STATE.ACTION_REQUIRED, actNowTotal: 3, currency: 'USD', ...over,
  });

  it('renders below the headline when there is a real figure', () => {
    actionable({ wastedAmount: 84310 });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('3 decisions need your attention.');
    expect(screen.getByText('$84,310 at risk.')).toBeInTheDocument();
  });

  it('is absent when wasted spend was never measured — never "$null"', () => {
    const { container } = render(
      <AccountStateHero state={ACCOUNT_STATE.ACTION_REQUIRED} actNowTotal={3} wastedAmount={null} currency="USD" />,
    );
    expect(screen.queryByText(/at risk/)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/null|undefined|NaN|—/);
    // the headline still stands on its own
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('3 decisions need your attention.');
  });

  it('uses the currency it is handed, not a hardcoded one', () => {
    actionable({ wastedAmount: 84310, currency: 'EGP' });
    expect(screen.queryByText(/\$84,310/)).not.toBeInTheDocument();
  });

  it('the healthy count is threaded through to the narrative', () => {
    setup({ state: ACCOUNT_STATE.PERFORMING_WELL, healthyCount: 21 });
    expect(screen.getByText('21 campaigns performing well.')).toBeInTheDocument();
  });

  // The advice branches on hasScorableData (the CONNECTOR graph), not on
  // hasAnyData — the scoring engine reads nothing else, so legacy-only rows are
  // "connect a channel", not "wait for signal".
  it('a scorable substrate picks the wait-for-signal advice', () => {
    setup({ state: ACCOUNT_STATE.LEARNING, hasAnyData: true, hasScorableData: true });
    expect(screen.getByText(/Verdicts appear once enough signal has accumulated/)).toBeInTheDocument();
    expect(screen.queryByText(/Connect a channel/)).not.toBeInTheDocument();
  });

  it('legacy rows with no connector channel are told to connect', () => {
    setup({ state: ACCOUNT_STATE.LEARNING, hasAnyData: true, hasScorableData: false });
    expect(screen.getByText('Connect a channel to get your first verdict.')).toBeInTheDocument();
  });
});

// ── PR#306: the briefing folds into the hero ────────────────
// It used to be a standalone card below the fold — a second, independently
// fetched narrative about the same account with nothing reconciling the two.
// Here it is subordinate and attributed; the caller owns the freshness gate.
describe("Lumi's read", () => {
  const withInsight = (over = {}) => render(
    <AccountStateHero state={ACCOUNT_STATE.ACTION_REQUIRED} actNowTotal={2} {...over} />,
  );

  it('renders the briefing under the deterministic lines, attributed', () => {
    withInsight({ insight: 'Two retargeting sets carry most of the waste.' });
    expect(screen.getByText('Two retargeting sets carry most of the waste.')).toBeInTheDocument();
    expect(screen.getByText(/Lumi’s read/)).toBeInTheDocument();
  });

  // Attribution is the point: everything else in this hero is deterministic.
  it('the headline stays the counts, never the prose', () => {
    withInsight({ insight: 'Some prose.' });
    expect(screen.getByRole('heading', { level: 1 }))
      .toHaveTextContent('2 decisions need your attention.');
  });

  it.each([[null], [undefined], ['']])('renders nothing at all for %s', (insight) => {
    withInsight({ insight });
    expect(screen.queryByText(/Lumi’s read/)).not.toBeInTheDocument();
  });
});

// ── PR#302: visual weight ───────────────────────────────────
describe('mission-control framing', () => {
  it('tints the hero border per state, keeping one surface', () => {
    const { container: kill } = render(<AccountStateHero state={ACCOUNT_STATE.ACTION_REQUIRED} actNowTotal={2} />);
    const { container: well } = render(<AccountStateHero state={ACCOUNT_STATE.PERFORMING_WELL} />);
    expect(kill.querySelector('header').className).toContain('border-signal-kill/20');
    expect(well.querySelector('header').className).toContain('border-signal-scale/20');
    // same surface — a red-filled hero would shout on a routine day
    expect(kill.querySelector('header').className).toContain('bg-lumi-surface');
    expect(well.querySelector('header').className).toContain('bg-lumi-surface');
  });

  // marcom-ds/no-generic-tailwind rejects text-xl/2xl/3xl; the role class is
  // also what keeps the headline bigger than .metric-display.
  it('the h1 uses the .page-title role class, not a raw size utility', () => {
    setup({ state: ACCOUNT_STATE.PERFORMING_WELL });
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.className).toContain('page-title');
    expect(h1.className).not.toMatch(/text-(xl|2xl|3xl)/);
  });

  it('the money is supporting copy, not the headline', () => {
    setup({ state: ACCOUNT_STATE.ACTION_REQUIRED, actNowTotal: 3, wastedAmount: 84310, currency: 'USD' });
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('3 decisions need your attention.');
    expect(h1).not.toHaveTextContent('84,310');           // the figure is NOT the h1
    expect(screen.getByText('$84,310 at risk.').tagName).toBe('P');
  });
});

describe('the primary action', () => {
  it('appears only for ACTION_REQUIRED', () => {
    setup({ state: ACCOUNT_STATE.ACTION_REQUIRED, actNowTotal: 2 });
    expect(screen.getByRole('link', { name: /Review decisions/ })).toBeInTheDocument();
  });

  it.each([
    [ACCOUNT_STATE.WATCH_CLOSELY],
    [ACCOUNT_STATE.PERFORMING_WELL],
    [ACCOUNT_STATE.LEARNING],
  ])('is absent for %s — nothing to review', (state) => {
    setup({ state });
    expect(screen.queryByRole('link', { name: /Review decisions/ })).not.toBeInTheDocument();
  });

  // ACTION_REQUIRED implies actNowTotal > 0, which is exactly when
  // ActNowSection (id="act-now") mounts — so this can never dangle.
  it('targets the Act-now anchor', () => {
    setup({ state: ACCOUNT_STATE.ACTION_REQUIRED, actNowTotal: 2 });
    expect(screen.getByRole('link', { name: /Review decisions/ })).toHaveAttribute('href', '#act-now');
  });
});

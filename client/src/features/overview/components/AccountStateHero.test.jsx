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

  it('hasAnyData picks the right LEARNING advice', () => {
    setup({ state: ACCOUNT_STATE.LEARNING, hasAnyData: true });
    expect(screen.getByText('No campaigns have enough data to score yet.')).toBeInTheDocument();
    expect(screen.queryByText(/Connect a channel/)).not.toBeInTheDocument();
  });
});

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

  it('no workspace name → the subtitle is omitted, never rendered blank', () => {
    setup({ state: ACCOUNT_STATE.PERFORMING_WELL, workspace: null });
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByText('Acme Co')).not.toBeInTheDocument();
  });

  it('renders the workspace name when there is one', () => {
    setup({ state: ACCOUNT_STATE.PERFORMING_WELL, workspace: { name: 'Acme Co' } });
    expect(screen.getByText('Acme Co')).toBeInTheDocument();
  });
});

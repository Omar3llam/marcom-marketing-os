// ============================================================
// CalibrationSection — the gate is the backend's, not the client's
// ------------------------------------------------------------
// Below RELIABLE coverage the component must emit NO calibration number. It also
// must not be named "learning": Home carries a second, unrelated outcome counter
// (#298's "Workspace track record"), and two differently-denominated numbers
// under the same noun read as a contradiction.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CalibrationSection from './CalibrationSection.jsx';

const GATED = { gated: true, headline: 'Still learning this account (0 decisions scored, need 30)', scored: 0, needed: 30 };
const RELIABLE = { gated: false, headline: "Lumi's calls on this account: calibration error 8%", scored: 41, needed: 30 };

describe('gated (coverage below RELIABLE)', () => {
  it('states the progress toward a claim, never the claim', () => {
    render(<CalibrationSection surface={GATED} />);
    expect(screen.getByText(/Collecting verified outcomes — 0 of 30 decisions recorded\./)).toBeInTheDocument();
  });

  // The backend's own gated string mentions "learning"; surfacing it here would
  // collide with the workspace track record on the same page.
  it('does not render the backend gated headline verbatim', () => {
    render(<CalibrationSection surface={GATED} />);
    expect(screen.queryByText(/Still learning this account/)).not.toBeInTheDocument();
  });

  it('leaks no calibration percentage', () => {
    const { container } = render(<CalibrationSection surface={GATED} />);
    expect(container.textContent).not.toMatch(/calibration error/i);
  });

  it('quotes the backend counts, not a client-side guess', () => {
    render(<CalibrationSection surface={{ ...GATED, scored: 11, needed: 25 }} />);
    expect(screen.getByText(/11 of 25 decisions recorded/)).toBeInTheDocument();
  });
});

describe('RELIABLE', () => {
  it('renders the backend headline as-is', () => {
    render(<CalibrationSection surface={RELIABLE} />);
    expect(screen.getByText(RELIABLE.headline)).toBeInTheDocument();
  });
});

describe('naming', () => {
  it('is labelled Decision Calibration, distinct from the workspace track record', () => {
    render(<CalibrationSection surface={GATED} />);
    expect(screen.getByText('Decision Calibration')).toBeInTheDocument();
    expect(screen.queryByText(/Workspace/i)).not.toBeInTheDocument();
  });
});

describe('honest absence', () => {
  it('no surface → renders nothing', () => {
    const { container } = render(<CalibrationSection surface={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

// ============================================================
// ProofView — learning-velocity sparkline (Fix 4)
// ------------------------------------------------------------
// The velocity section renders a compact sparkline PLUS the number row (the
// numbers stay the evidence — anti-Looker holds). The sparkline needs ≥ 2
// periods; below that it renders nothing (never a fabricated trend). The trend
// badge (IMPROVING / DEGRADING / STEADY) is colour-coded from the backend trend.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProofView } from './ProofView.jsx';

const reliableSurface = { gated: false, headline: 'Lumi is well-calibrated on this account.' };
const baseCal = { expectedCalibrationError: 0.08, brierScore: 0.1, direction: 'well-calibrated', accuracy: 0.72, bins: [] };

function renderProof(velocity) {
  return render(
    <MemoryRouter>
      <ProofView
        role="STRATEGIST"
        surface={reliableSurface}
        data={{ calibration: baseCal, velocity, coverage: { verdict: 'RELIABLE' } }}
      />
    </MemoryRouter>,
  );
}

describe('ProofView — learning velocity', () => {
  it('renders the sparkline + IMPROVING badge with 2+ periods', () => {
    const { getByText, container } = renderProof({
      trend: 'IMPROVING',
      periods: [
        { label: 'Jan', calibrationError: 0.20, sampleSize: 40 },
        { label: 'Feb', calibrationError: 0.13, sampleSize: 45 },
        { label: 'Mar', calibrationError: 0.08, sampleSize: 50 },
      ],
    });
    expect(getByText('IMPROVING')).toBeTruthy();
    const svg = container.querySelector('svg[aria-label="Learning velocity trend"]');
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('class')).toContain('text-signal-scale'); // improving → green
    // the numbers stay as evidence
    expect(getByText(/Jan:/)).toBeTruthy();
  });

  it('hides the sparkline with fewer than 2 periods (no fake trend)', () => {
    const { getByText, container } = renderProof({
      trend: 'INSUFFICIENT_DATA',
      periods: [{ label: 'Jan', calibrationError: 0.20, sampleSize: 40 }],
    });
    // section + number still shown, but no sparkline glyph
    expect(getByText(/Jan:/)).toBeTruthy();
    expect(container.querySelector('svg[aria-label="Learning velocity trend"]')).toBeNull();
  });

  it('degrading trend → DEGRADING badge + amber sparkline', () => {
    const { getByText, container } = renderProof({
      trend: 'DEGRADING',
      periods: [
        { label: 'Jan', calibrationError: 0.08, sampleSize: 40 },
        { label: 'Feb', calibrationError: 0.18, sampleSize: 45 },
      ],
    });
    expect(getByText('DEGRADING')).toBeTruthy();
    const svg = container.querySelector('svg[aria-label="Learning velocity trend"]');
    expect(svg.getAttribute('class')).toContain('text-signal-hold');
  });
});

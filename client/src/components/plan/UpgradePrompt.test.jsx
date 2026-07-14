// ============================================================
// UpgradePrompt — the PlanGate route fallback
// ------------------------------------------------------------
// Honest over silent: names the feature + the tier that unlocks it and links to
// the pricing page (no in-app checkout). Pure component; no providers needed.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import UpgradePrompt from './UpgradePrompt.jsx';

describe('UpgradePrompt', () => {
  it('names the gated feature and the tier that unlocks it', () => {
    render(<UpgradePrompt feature="Intelligence" requiredPlan="GROWTH" />);
    expect(screen.getByText(/Intelligence is a Growth feature/i)).toBeInTheDocument();
  });

  it('links out to the pricing page (no in-app checkout)', () => {
    render(<UpgradePrompt feature="Testing" requiredPlan="PRO" />);
    const link = screen.getByRole('link', { name: /view plans/i });
    expect(link).toHaveAttribute('href', '/#pricing');
  });
});

// ============================================================
// RevenueOnboardingBanner — pure, prop-driven render
// ------------------------------------------------------------
// The post-first-sync revenue prompt. Copy is keyed off the REAL scored-campaign
// count (no fabricated conversion sub-count), the CTA links straight to the
// revenue-settings route (zero friction), and dismiss is a pure callback.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RevenueOnboardingBanner from './RevenueOnboardingBanner.jsx';

const renderBanner = (props = {}) =>
  render(
    <MemoryRouter>
      <RevenueOnboardingBanner campaignCount={7} onDismiss={() => {}} {...props} />
    </MemoryRouter>,
  );

describe('RevenueOnboardingBanner', () => {
  it('states how many campaigns were scored (real count, pluralized)', () => {
    renderBanner({ campaignCount: 7 });
    expect(screen.getByText(/scored 7 campaigns on engagement signals/i)).toBeInTheDocument();
  });

  it('uses the singular form for a single campaign', () => {
    renderBanner({ campaignCount: 1 });
    expect(screen.getByText(/scored 1 campaign on engagement signals/i)).toBeInTheDocument();
  });

  it('links the upload CTA straight to the revenue-settings route', () => {
    renderBanner();
    const cta = screen.getByRole('link', { name: /Upload revenue data/i });
    expect(cta).toHaveAttribute('href', '/app/settings/revenue');
  });

  it('fires onDismiss when the dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    renderBanner({ onDismiss });
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

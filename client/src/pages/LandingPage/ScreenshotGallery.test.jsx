// ============================================================
// ScreenshotGallery — tab switching + caption/image binding
// ------------------------------------------------------------
// useReveal is mocked (no IntersectionObserver in jsdom) so we render shown.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('./useReveal.js', () => ({ useReveal: () => [{ current: null }, true] }));
import { ScreenshotGallery } from './ScreenshotGallery.jsx';

describe('ScreenshotGallery', () => {
  it('defaults to the first tab + its caption', () => {
    render(<ScreenshotGallery />);
    expect(screen.getByRole('tab', { name: /today's agenda/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/no noise, no dashboards/i)).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', '/screenshots/overview.png');
  });

  it('switches caption + active image when another tab is clicked', () => {
    render(<ScreenshotGallery />);
    fireEvent.click(screen.getByRole('tab', { name: /blended truth/i }));
    expect(screen.getByText(/the gap is your real cost/i)).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', '/screenshots/intelligence.png');
  });
});

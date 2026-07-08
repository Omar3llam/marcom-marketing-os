// ============================================================
// HelpTip — hover tooltip + click popover (self-contained)
// ------------------------------------------------------------
// tooltip: opens on hover/focus, closes on leave. popover: opens on click,
// shows title + description (+ optional link), closes on Escape. Null content
// renders nothing.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HelpTip } from './HelpTip.jsx';

describe('HelpTip — tooltip variant', () => {
  it('shows the one-liner on hover and hides on leave', () => {
    render(<HelpTip content="Click-through rate." />);
    const trigger = screen.getByRole('button', { name: /help/i });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Click-through rate.');

    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('also opens on keyboard focus (accessible, not hover-only)', () => {
    render(<HelpTip content="Average times each person saw your ad." />);
    fireEvent.focus(screen.getByRole('button', { name: /help/i }));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });
});

describe('HelpTip — popover variant', () => {
  const content = { title: 'Wasted Spend', description: 'Spend on KILL or REFRESH campaigns.' };

  it('opens on click with title + description', () => {
    render(<HelpTip variant="popover" content={content} />);
    expect(screen.queryByText('Wasted Spend')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /help/i }));
    expect(screen.getByText('Wasted Spend')).toBeInTheDocument();
    expect(screen.getByText('Spend on KILL or REFRESH campaigns.')).toBeInTheDocument();
  });

  it('renders a "Learn more" link when provided', () => {
    render(<HelpTip variant="popover" content={{ ...content, link: '/docs' }} />);
    fireEvent.click(screen.getByRole('button', { name: /help/i }));
    expect(screen.getByRole('link', { name: /learn more/i })).toHaveAttribute('href', '/docs');
  });

  it('closes on Escape', () => {
    render(<HelpTip variant="popover" content={content} />);
    fireEvent.click(screen.getByRole('button', { name: /help/i }));
    expect(screen.getByText('Wasted Spend')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Wasted Spend')).not.toBeInTheDocument();
  });
});

describe('HelpTip — guards', () => {
  it('renders nothing when content is null', () => {
    const { container } = render(<HelpTip content={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

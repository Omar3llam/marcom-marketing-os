import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { useFocusTrap } from './useFocusTrap.js';

function Dialog({ onEscape }) {
  const ref = useFocusTrap(true, onEscape);
  return (
    <div ref={ref} role="dialog" aria-modal="true">
      <button>first</button>
      <button>last</button>
    </div>
  );
}

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>open</button>
      {open && <Dialog onEscape={() => setOpen(false)} />}
    </>
  );
}

describe('useFocusTrap', () => {
  it('moves focus to the first focusable element when the modal opens', () => {
    render(<Harness />);
    const trigger = screen.getByText('open');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);

    expect(document.activeElement).toBe(screen.getByText('first'));
  });

  it('traps Tab / Shift+Tab within the modal', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('open'));
    const dialog = screen.getByRole('dialog');
    const first = screen.getByText('first');
    const last = screen.getByText('last');

    // Shift+Tab at the first element wraps to the last.
    first.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    // Tab at the last element wraps to the first.
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('returns focus to the trigger when the modal closes', () => {
    render(<Harness />);
    const trigger = screen.getByText('open');
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByText('first'));

    // Escape -> onEscape closes the modal -> focus restored to the trigger.
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

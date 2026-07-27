// ============================================================
// ConfirmModal — a blocking confirm that can state consequences
// ------------------------------------------------------------
// Replaces window.confirm, which cannot be styled, cannot speak in the
// product's voice, and cannot be asserted on.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmModal } from './ConfirmModal.jsx';

const props = (over = {}) => ({
  open: true, title: 'Last strategist', description: 'This strands the workspace.',
  onConfirm: vi.fn(), onCancel: vi.fn(), ...over,
});

describe('ConfirmModal — visibility', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<ConfirmModal {...props({ open: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the title, the description and both actions when open', () => {
    render(<ConfirmModal {...props({ confirmLabel: 'Downgrade anyway' })} />);
    expect(screen.getByText('Last strategist')).toBeInTheDocument();
    expect(screen.getByText('This strands the workspace.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Downgrade anyway' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('is an alertdialog, so assistive tech announces it as blocking', () => {
    render(<ConfirmModal {...props()} />);
    expect(screen.getByRole('alertdialog')).toHaveAttribute('aria-modal', 'true');
  });
});

describe('ConfirmModal — actions', () => {
  it('confirming calls onConfirm only', () => {
    const p = props();
    render(<ConfirmModal {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(p.onConfirm).toHaveBeenCalledTimes(1);
    expect(p.onCancel).not.toHaveBeenCalled();
  });

  it('cancelling calls onCancel only', () => {
    const p = props();
    render(<ConfirmModal {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(p.onCancel).toHaveBeenCalledTimes(1);
    expect(p.onConfirm).not.toHaveBeenCalled();
  });

  it('Escape cancels', () => {
    const p = props();
    render(<ConfirmModal {...p} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(p.onCancel).toHaveBeenCalled();
  });

  // Clicking the dialog body must not dismiss it — only the backdrop does.
  it('a click inside the dialog does not cancel', () => {
    const p = props();
    render(<ConfirmModal {...p} />);
    fireEvent.click(screen.getByRole('alertdialog'));
    expect(p.onCancel).not.toHaveBeenCalled();
  });
});

describe('ConfirmModal — variants', () => {
  it('warning uses the gold treatment', () => {
    render(<ConfirmModal {...props({ variant: 'warning' })} />);
    expect(screen.getByText('Last strategist')).toHaveClass('text-lumi-gold');
    expect(screen.getByRole('button', { name: 'Continue' }).className).toMatch(/bg-lumi-gold/);
  });

  it('danger uses the kill signal', () => {
    render(<ConfirmModal {...props({ variant: 'danger' })} />);
    expect(screen.getByText('Last strategist')).toHaveClass('text-signal-kill');
    expect(screen.getByRole('button', { name: 'Continue' }).className).toMatch(/bg-signal-kill/);
  });

  it('an unknown variant falls back to warning rather than rendering unstyled', () => {
    render(<ConfirmModal {...props({ variant: 'nonsense' })} />);
    expect(screen.getByText('Last strategist')).toHaveClass('text-lumi-gold');
  });
});

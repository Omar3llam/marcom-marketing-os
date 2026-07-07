// ============================================================
// RevenueCsvTab — the three prop-driven state views
// ------------------------------------------------------------
// Container wiring (hooks) is thin; the states are pure + exported so we test
// them directly: column-mapping renders real column names and gates Confirm
// until both are mapped; results shows matched + unmatched honestly and the
// "Run sweep" button fires the loop.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UploadState, MappingState, ResultsState } from './RevenueCsvTab.jsx';

describe('UploadState', () => {
  it('hands the chosen file to onFile', () => {
    const onFile = vi.fn();
    const { container } = render(<UploadState onFile={onFile} />);
    const input = container.querySelector('input[type="file"]');
    const file = new File(['Campaign,Revenue\nX,1'], 'rev.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFile).toHaveBeenCalledWith(file);
  });
});

describe('MappingState', () => {
  const base = {
    columns: ['Campaign', 'Revenue', 'Notes'],
    preview: [{ Campaign: 'Folla', Revenue: '12500' }],
    currency: 'EGP', setCurrency: () => {}, setMapping: () => {},
    onConfirm: vi.fn(), onBack: vi.fn(), isUploading: false,
  };

  it('renders the real column names as options (in both mapping selects)', () => {
    render(<MappingState {...base} mapping={{ identifier: '', revenue: '' }} />);
    const optionTexts = screen.getAllByRole('option').map((o) => o.textContent);
    expect(optionTexts).toContain('Campaign');
    expect(optionTexts).toContain('Revenue');
    expect(optionTexts).toContain('Notes');
  });

  it('disables Confirm until BOTH identifier and revenue are mapped', () => {
    const { rerender } = render(<MappingState {...base} mapping={{ identifier: 'Campaign', revenue: '' }} />);
    expect(screen.getByRole('button', { name: /Confirm/i })).toBeDisabled();

    rerender(<MappingState {...base} mapping={{ identifier: 'Campaign', revenue: 'Revenue' }} />);
    const confirm = screen.getByRole('button', { name: /Confirm/i });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(base.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('shows the preview once both columns are mapped', () => {
    render(<MappingState {...base} mapping={{ identifier: 'Campaign', revenue: 'Revenue' }} />);
    expect(screen.getByText('Folla')).toBeInTheDocument();
    expect(screen.getByText('12500')).toBeInTheDocument();
  });
});

describe('ResultsState', () => {
  const result = {
    matched: 10, updated: 10,
    unmatched: [{ identifier: 'Folla Insta', reason: 'no matching campaign' }],
    errors: [],
  };

  it('shows the matched count and surfaces unmatched rows honestly', () => {
    render(<ResultsState result={result} onRunSweep={() => {}} sweeping={false} onDone={() => {}} />);
    expect(screen.getByText(/10 campaigns matched and updated/i)).toBeInTheDocument();
    expect(screen.getByText(/Folla Insta/)).toBeInTheDocument();
    expect(screen.getByText(/no matching campaign/)).toBeInTheDocument();
  });

  it('the Run sweep button fires onRunSweep', () => {
    const onRunSweep = vi.fn();
    render(<ResultsState result={result} onRunSweep={onRunSweep} sweeping={false} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Run sweep/i }));
    expect(onRunSweep).toHaveBeenCalledTimes(1);
  });

  it('no unmatched/errors → clean success, no "not applied" block', () => {
    render(<ResultsState result={{ matched: 3, updated: 3, unmatched: [], errors: [] }} onRunSweep={() => {}} sweeping={false} onDone={() => {}} />);
    expect(screen.getByText(/3 campaigns matched and updated/i)).toBeInTheDocument();
    expect(screen.queryByText(/not applied/i)).not.toBeInTheDocument();
  });
});

// ============================================================
// LoopStatusCompact — a status rail must not invent a status
// ------------------------------------------------------------
// It reads the loop contract's REAL fields (loopHealth, lastRunAt). There is no
// `label` or `finishedAt` on the wire — the label is derived here.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoopStatusCompact from './LoopStatusCompact.jsx';

describe('renders the real contract fields', () => {
  it('shows the derived health label and the last sweep time', () => {
    render(<LoopStatusCompact loop={{ loopHealth: 'HEALTHY', lastRunAt: new Date(Date.now() - 90 * 60_000).toISOString() }} />);
    expect(screen.getByText('Last sweep')).toBeInTheDocument();
    expect(screen.getByText('Loop healthy')).toBeInTheDocument();
    expect(screen.getByText(/2h ago/)).toBeInTheDocument();
  });

  it.each([
    ['HEALTHY',  'Loop healthy'],
    ['DEGRADED', 'Loop degraded'],
    ['STALLED',  'Loop stalled'],
  ])('%s → "%s"', (loopHealth, label) => {
    render(<LoopStatusCompact loop={{ loopHealth, lastRunAt: null }} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('a loop that has never run says "never", not a fabricated time', () => {
    render(<LoopStatusCompact loop={{ loopHealth: 'STALLED', lastRunAt: null }} />);
    expect(screen.getByText(/never/)).toBeInTheDocument();
  });
});

describe('honest absence', () => {
  // An "unknown" row in a status rail reads as a fault that isn't there.
  it.each([
    ['no loop at all', undefined],
    ['null loop',      null],
    ['no loopHealth',  { lastRunAt: '2026-07-30T00:00:00Z' }],
  ])('%s → renders nothing', (_label, loop) => {
    const { container } = render(<LoopStatusCompact loop={loop} />);
    expect(container).toBeEmptyDOMElement();
  });

  // The backend enum could grow; "Loop FOO" is worse than saying nothing.
  it('an unrecognised health value renders nothing rather than raw text', () => {
    const { container } = render(<LoopStatusCompact loop={{ loopHealth: 'FOO', lastRunAt: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('cannot act', () => {
  // The only sweep trigger stays with the full ring below the fold — two
  // buttons firing the same job is how a user double-sweeps.
  it('renders no button', () => {
    const { container } = render(<LoopStatusCompact loop={{ loopHealth: 'STALLED', lastRunAt: null }} />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});

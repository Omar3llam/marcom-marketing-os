// ============================================================
// OutputDone — Creative Strategy card (PR #256)
// ------------------------------------------------------------
// The strategy card leads the output when a strategy is present, is hidden
// entirely otherwise (older generations, or copy that produced none), renders
// `core_message` under a "Core message" label, and hides any null field. The
// copy variants still render below it (unchanged).
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OutputDone } from './OutputComponents.jsx';

const STRATEGY = {
  objective: 'Book private viewings',
  core_message: 'Own the skyline',
  hook: 'Wake up above the city',
  visual: 'Sunset terrace with skyline',
  cta_direction: 'Warm — invite to a tour',
};

const baseOpts = { copy: true, headlines: false, cta: false, visual: false, video: false };

function renderDone(content, opts = baseOpts) {
  return render(<OutputDone content={content} opts={opts} tone="Bold & rebellious" onRegenerate={vi.fn()} />);
}

describe('OutputDone — Creative Strategy card', () => {
  it('renders the card with subtitle when a strategy is present', () => {
    renderDone({ strategy: STRATEGY, copy: [{ tag: 'STORY', text: 'A story.' }] });
    expect(screen.getByText('Creative strategy')).toBeInTheDocument();
    expect(screen.getByText('Generated from the campaign diagnosis and your brief.')).toBeInTheDocument();
    // every populated field renders (label + value)
    expect(screen.getByText('Objective')).toBeInTheDocument();
    expect(screen.getByText('Book private viewings')).toBeInTheDocument();
    expect(screen.getByText('Own the skyline')).toBeInTheDocument();
  });

  it('labels core_message as "Core message" (not "message")', () => {
    renderDone({ strategy: STRATEGY, copy: [{ tag: 'STORY', text: 'A story.' }] });
    expect(screen.getByText('Core message')).toBeInTheDocument();
  });

  it('hides the card entirely when strategy is null (older generations)', () => {
    renderDone({ strategy: null, copy: [{ tag: 'STORY', text: 'A story.' }] });
    expect(screen.queryByText('Creative strategy')).not.toBeInTheDocument();
  });

  it('hides a strategy row whose value is missing', () => {
    renderDone({ strategy: { ...STRATEGY, visual: null }, copy: [{ tag: 'STORY', text: 'A story.' }] });
    expect(screen.getByText('Objective')).toBeInTheDocument();
    expect(screen.queryByText('Visual')).not.toBeInTheDocument();
  });

  it('still renders the copy variants below the strategy card (unchanged)', () => {
    renderDone({ strategy: STRATEGY, copy: [{ tag: 'STORY', text: 'A story below.' }] });
    expect(screen.getByText('Copy variants')).toBeInTheDocument();
    expect(screen.getByText('A story below.')).toBeInTheDocument();
  });
});

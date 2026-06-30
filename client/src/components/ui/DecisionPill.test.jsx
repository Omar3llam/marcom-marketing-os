// ============================================================
// VerdictPill — the full engine vocabulary renders REAL badges
// ------------------------------------------------------------
// Phase-2 verdicts (REFRESH/REALLOCATE) and the awareness-track verdicts
// (REFRESH/WATCH/HOLD) must look as real as KILL/SCALE — never the gray fallback
// ("a lesser badge"). An awareness verdict is a real verdict, just from different
// signals. These pin a real semantic color for every verdict in the vocabulary.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VerdictPill } from './DecisionPill.jsx';

describe('VerdictPill — every verdict gets a real semantic color, never the gray fallback', () => {
  it.each([
    ['KILL',       'text-signal-kill'],
    ['HOLD',       'text-signal-hold'],
    ['SCALE',      'text-signal-scale'],
    ['WATCH',      'text-signal-hold'],
    ['REFRESH',    'text-stage-testing'],
    ['REALLOCATE', 'text-stage-scaling'],
  ])('%s → %s (not the lumi-muted fallback)', (verdict, token) => {
    render(<VerdictPill verdict={verdict} />);
    const pill = screen.getByLabelText(`Verdict: ${verdict}`);
    expect(pill.className).toContain(token);
    expect(pill.className).not.toContain('text-lumi-muted'); // the fallback
  });

  it('an unrecognised verdict still renders (graceful fallback, no crash)', () => {
    render(<VerdictPill verdict="ZORP" />);
    expect(screen.getByLabelText('Verdict: ZORP')).toBeInTheDocument();
  });
});

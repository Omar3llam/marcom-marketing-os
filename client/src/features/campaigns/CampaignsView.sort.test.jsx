// ============================================================
// CampaignsView sort helpers — verdict column is sortable by urgency
// ------------------------------------------------------------
// Audit 2026-07: the "Decision" (verdict) column header wasn't clickable —
// sortableCols omitted it. Now it sorts by ACTION URGENCY (KILL first, SCALE
// last), not alphabetically, and an unknown verdict sinks in both directions
// like a null metric. These pin the comparator contract without booting the
// whole page (which needs the campaign-feed context + hooks).
// ============================================================
import { describe, it, expect } from 'vitest';
import { compareRows, sortableCols } from './CampaignsView.jsx';
// The ranking moved to a shared leaf so the PDF export can consume the SAME one
// instead of its own drifted copy. Imported from there, not re-exported through
// the view — a second import path is how the second copy started.
import { VERDICT_RANK } from '@/lib/verdictRank.js';

const rowsWith = (...verdicts) => verdicts.map((verdict, i) => ({ id: `r${i}`, verdict }));

function sortedVerdicts(verdicts, dir) {
  return [...rowsWith(...verdicts)]
    .sort((a, b) => compareRows(a, b, 'verdict', dir))
    .map((r) => r.verdict);
}

describe('verdict column sortability', () => {
  it('is registered as a sortable column', () => {
    expect(sortableCols.has('verdict')).toBe(true);
  });

  it('ranks all six engine verdicts (no gaps, KILL worst → SCALE best)', () => {
    expect(Object.keys(VERDICT_RANK).sort()).toEqual(
      ['HOLD', 'KILL', 'REALLOCATE', 'REFRESH', 'SCALE', 'WATCH'],
    );
    expect(VERDICT_RANK.KILL).toBeLessThan(VERDICT_RANK.SCALE);
  });

  it('ascending → most-actionable first (KILL), good news last (SCALE)', () => {
    const out = sortedVerdicts(['SCALE', 'HOLD', 'KILL', 'REFRESH', 'WATCH', 'REALLOCATE'], 'asc');
    expect(out).toEqual(['KILL', 'REFRESH', 'REALLOCATE', 'WATCH', 'HOLD', 'SCALE']);
  });

  it('descending → SCALE first, KILL last (the exact reverse)', () => {
    const out = sortedVerdicts(['KILL', 'SCALE', 'HOLD'], 'desc');
    expect(out).toEqual(['SCALE', 'HOLD', 'KILL']);
  });

  it('does NOT sort alphabetically (HOLD would beat KILL alphabetically, but ranks lower)', () => {
    // Alphabetical asc would be [HOLD, KILL, SCALE]; urgency asc is [KILL, HOLD, SCALE].
    expect(sortedVerdicts(['SCALE', 'HOLD', 'KILL'], 'asc')).toEqual(['KILL', 'HOLD', 'SCALE']);
  });

  it('an unknown verdict sinks to the bottom in BOTH directions', () => {
    expect(sortedVerdicts(['KILL', 'MYSTERY', 'SCALE'], 'asc')).toEqual(['KILL', 'SCALE', 'MYSTERY']);
    expect(sortedVerdicts(['KILL', 'MYSTERY', 'SCALE'], 'desc')).toEqual(['SCALE', 'KILL', 'MYSTERY']);
  });

  it('existing metric columns still compare numerically (regression guard)', () => {
    const rows = [{ spend: 30 }, { spend: null }, { spend: 10 }];
    const asc = [...rows].sort((a, b) => compareRows(a, b, 'spend', 'asc')).map((r) => r.spend);
    expect(asc).toEqual([10, 30, null]); // nulls sink, numbers ascend
  });
});

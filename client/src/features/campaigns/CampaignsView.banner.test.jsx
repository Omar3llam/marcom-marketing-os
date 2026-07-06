// ============================================================
// splitNoRevenueVerdicts — objective-aware no-revenue banner split
// ------------------------------------------------------------
// A no-revenue campaign (roas null) is scored on engagement either way, but the
// HONEST framing depends on its objective: awareness = no revenue by design;
// a conversion campaign with no measured revenue = a fixable tracking gap.
// revenueExpected is the server-derived flag (from the Meta objective). Lumping
// both as "awareness" is the exact dishonesty the objective work removed.
// ============================================================
import { describe, it, expect } from 'vitest';
import { splitNoRevenueVerdicts } from './CampaignsView.jsx';

const v = (over) => ({ roas: null, revenueExpected: false, ...over });

describe('splitNoRevenueVerdicts', () => {
  it('a conversion campaign (revenueExpected) with no revenue → tracking gap, not awareness', () => {
    expect(splitNoRevenueVerdicts([v({ revenueExpected: true })]))
      .toEqual({ awarenessCount: 0, trackingGapCount: 1 });
  });

  it('an awareness campaign (revenue not expected) with no revenue → awareness', () => {
    expect(splitNoRevenueVerdicts([v({ revenueExpected: false })]))
      .toEqual({ awarenessCount: 1, trackingGapCount: 0 });
  });

  it('a campaign WITH measured revenue (roas set) is in neither bucket', () => {
    expect(splitNoRevenueVerdicts([v({ roas: 3.2, revenueExpected: true })]))
      .toEqual({ awarenessCount: 0, trackingGapCount: 0 });
  });

  it('a mixed account splits correctly', () => {
    const out = splitNoRevenueVerdicts([
      v({ revenueExpected: true }),           // gap
      v({ revenueExpected: true }),           // gap
      v({ revenueExpected: false }),          // awareness
      v({ roas: 4.0, revenueExpected: true }),// has revenue → neither
    ]);
    expect(out).toEqual({ awarenessCount: 1, trackingGapCount: 2 });
  });

  it('missing revenueExpected defaults to awareness (backward-compatible)', () => {
    expect(splitNoRevenueVerdicts([{ roas: null }]))
      .toEqual({ awarenessCount: 1, trackingGapCount: 0 });
  });

  it('empty input → zero/zero', () => {
    expect(splitNoRevenueVerdicts([])).toEqual({ awarenessCount: 0, trackingGapCount: 0 });
  });
});

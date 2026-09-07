// ============================================================
// B8-05 · R-E2 — a detail read may not be weaker than its own list
// ------------------------------------------------------------
// `listTests` carries the holdout's provenance, in its own words:
//
//     include: { sourceTest: { select: { id, dimension, hypothesis } } }
//     // …surface the A/B test a holdout was promoted from so the panel can
//     // show "From A/B test". Null for directly-designed holdouts.
//
// `getTest` — the by-id read behind `GET /incrementality/:id` — did not. So a
// holdout PROMOTED from a concluded A/B test, opened by its own id, came back
// with no `sourceTest` at all.
//
// That is not a missing decoration. `IncrementalityTestSchema` declares
// `sourceTest` as `.nullish()`, so the row parses cleanly and the surface reads
// "designed directly" for a holdout that was promoted. `undefined` (we did not
// ask) and `null` (there is no source) are the same value, and there is no
// token beside it to tell them apart — B8-04b's law, one layer lower: when a
// VALUE cannot decide an absence, something else must, and here nothing does.
//
// THE EXPECTATION IS DERIVED, NOT TYPED. Asserting a hand-written include here
// would prove only that two literals agreed on the day they were written —
// which is exactly what the drifted pair already did. Reading the list's own
// projection and requiring the detail to cover it means the invariant survives
// the next change to either.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMany = vi.fn().mockResolvedValue([]);
const findFirst = vi.fn().mockResolvedValue(null);

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    incrementalityTest: {
      findMany:   (...a) => findMany(...a),
      findFirst:  (...a) => findFirst(...a),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { listTests, getTest } from './IncrementalityService.js';

const WS = '00000000-0000-4000-8000-0000000b8050';
const ID = '00000000-0000-4000-8000-0000000b8051';

beforeEach(() => { findMany.mockClear(); findFirst.mockClear(); });

describe('B8-05 · R-E2 — the by-id read carries what the list carries', () => {
  it('T29 · getTest asks for sourceTest', async () => {
    await getTest(WS, ID);
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst.mock.calls[0][0]?.include?.sourceTest).toBeTruthy();
  });

  it('T30 · it asks for every sourceTest field the LIST asks for', async () => {
    await listTests(WS);
    await getTest(WS, ID);

    const listSelect = findMany.mock.calls[0][0].include.sourceTest.select;
    const detailSelect = findFirst.mock.calls[0][0]?.include?.sourceTest?.select ?? {};

    // Every provenance field the list can show, the detail can show too.
    for (const field of Object.keys(listSelect)) {
      expect(detailSelect[field]).toBe(true);
    }
  });

  it('T31 · it stays workspace-scoped — provenance never widens the jurisdiction', async () => {
    // An `include` is a projection, not a filter. Adding one must not disturb
    // the `where`, or a richer read becomes a cross-workspace read.
    await getTest(WS, ID);
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: ID, workspaceId: WS });
  });
});

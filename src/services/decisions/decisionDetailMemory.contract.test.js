// ============================================================
// B8-01 — the Decision publishes the memory it was committed against
// ------------------------------------------------------------
// WHAT THIS PROTECTS
//
//   `/decisions/:id` must state what memory said AT COMMITMENT, or state that
//   it was never asked. It may do neither silently.
//
// WHY IT NEEDS PROTECTING
//
// C-16 landed three columns on `decisions` — `memoryProvenance`,
// `baseConfidence`, `memoryStatus` — and DETAIL_SELECT never selected them, so
// the one read built to serve a Decision as a destination published none of
// them. The B7 consumer sweep classified this as `not published → backend
// select required`: the contract landed and never reached a reader.
//
// This is the THEN destination's own historical truth, NOT Memory. R-5 keeps
// provenance and Memory as two objects whose divergence is a fact and is never
// reconciled; publishing provenance here opens no Memory surface and crosses no
// entitlement boundary (`decisions.js` carries no plan gate — B7 Ruling 3).
//
// ── WHY THESE THREE TRAVEL FLAT ─────────────────────────────────────────────
// COMMITTED_FIELDS exists for fields "whose null is ambiguous, and which
// therefore carry a knowledge". These three are not that: `memoryStatus` IS the
// knowledge — C-16 declared NOT_CONSULTED and mapped it to C-06's
// COULD_NOT_LOOK. A null `memoryProvenance` beside a stated `memoryStatus` is
// already unambiguous, so wrapping it in a second knowledge token would publish
// the same fact twice and invite the two to disagree. They travel flat for the
// reason `guardrailRuleId` does: the field that explains the null is published
// beside it.
//
// ── WHAT THIS FILE DOES NOT DO ──────────────────────────────────────────────
// It does not join. Provenance is a COLUMN, because C-16 froze it by value
// precisely so a reader would never have to traverse to a pattern row that has
// since been rewritten. The existing "touches no model but `decision`" ratchet
// in decisionDetail.contract.test.js stays green, and must.
// ============================================================
import { describe, it, expect } from 'vitest';
import { DETAIL_SELECT, detailBody, COMMITTED_FIELDS } from './decisionDetail.js';

/** A row as Prisma would hand it back under DETAIL_SELECT. */
const row = (over = {}) => ({
  id: 'dec_1', decisionClass: 'SIGNAL', entityId: 'camp_1', entityLevel: 'CAMPAIGN',
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  verdict: 'KILL', confidence: 0.71, diagnosis: 'ROAS below floor', rootCause: null,
  status: 'SUPERSEDED',
  explainedAt: null, intentAt: null,
  humanExecutedAt: null, platformExecutedAt: null, dismissedAt: null,
  resolvedAt: null, resolution: null, confidenceDelta: null, closureReason: null,
  humanResponse: null, humanReasonCode: null, humanReasonNote: null, humanRespondedAt: null,
  ctrAtDecision: null, roasAtDecision: null, objective: null, channel: null,
  hypotheses: null, counterfactuals: null, evidenceReference: null,
  guardrailRuleId: null, openHitKey: null,
  baseConfidence: 0.8, memoryStatus: 'OK',
  memoryProvenance: {
    factor: 0.89, applied: true,
    patterns: [{ patternId: 'pat_1', statement: 'KILL calls on this account hold up', accuracy: 0.8, effectiveSupport: 12 }],
  },
  ...over,
});

describe('B8-01 · the projection selects what the response promises', () => {
  it.each(['memoryProvenance', 'baseConfidence', 'memoryStatus'])(
    'DETAIL_SELECT selects %s', (field) => {
      expect(DETAIL_SELECT[field]).toBe(true);
    },
  );

  it('keeps the three OUT of COMMITTED_FIELDS — memoryStatus is the knowledge', () => {
    for (const f of ['memoryProvenance', 'baseConfidence', 'memoryStatus']) {
      expect(COMMITTED_FIELDS).not.toContain(f);
    }
  });
});

describe('B8-01 · detailBody states the memory measured at commitment', () => {
  it('publishes the provenance BY VALUE, patterns and all', () => {
    const body = detailBody(row());
    expect(body.memoryProvenance).toEqual({
      factor: 0.89, applied: true,
      patterns: [{ patternId: 'pat_1', statement: 'KILL calls on this account hold up', accuracy: 0.8, effectiveSupport: 12 }],
    });
  });

  it('publishes baseConfidence beside confidence, so the shift is legible', () => {
    const body = detailBody(row());
    // The engine's own number and the number the operator was shown. R-6 makes
    // the pair the fact; either alone cannot say memory moved anything.
    expect(body.baseConfidence).toBe(0.8);
    expect(body.confidence).toBe(0.71);
  });

  it('publishes memoryStatus so an absent provenance explains itself', () => {
    const body = detailBody(row({ memoryStatus: 'NOT_CONSULTED', memoryProvenance: null }));
    expect(body.memoryStatus).toBe('NOT_CONSULTED');
    expect(body.memoryProvenance).toBeNull();
  });

  it('STATES the absence rather than omitting it — null, not undefined', () => {
    // The file's own rule for the closure axes: omission reads as "not part of
    // this response"; null says "we looked, and it has not happened".
    const body = detailBody(row({ memoryProvenance: undefined, baseConfidence: undefined, memoryStatus: undefined }));
    for (const f of ['memoryProvenance', 'baseConfidence', 'memoryStatus']) {
      expect(f in body).toBe(true);
      expect(body[f]).toBeNull();
    }
  });

  it('a null baseConfidence is not a zero — C-16 invariant, restated at the boundary', () => {
    const body = detailBody(row({ baseConfidence: null, confidence: null }));
    expect(body.baseConfidence).toBeNull();
    expect(body.confidence).toBeNull();
  });
});

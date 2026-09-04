// ============================================================
// C-12 · T11–T13 — two verdicts per campaign, named and never reconciled (RED)
// ------------------------------------------------------------
// connectorVerdictService publishes both, deliberately and honestly:
//
//     verdict          live, recomputed every read, persists nothing
//     decisionVerdict  stored, what Lumi committed to at a past sweep
//
// The code's own words: "Two different questions, deliberately not reconciled
// here." Correct. But the frontend collapses them by omission —
// `decisionVerdict` is assigned at CampaignsView.jsx:420 and read by NO
// component — so the operator sees the LIVE verdict while their Execute /
// Dismiss / Judgment attaches to the STORED Decision, and nothing says they can
// differ.
//
// R-1 gives the rule exactly: VERDICT EQUALITY ALONE determines agreement, and
// a confidence difference is NOT divergence. B7-06 forbids showing then and now
// side by side as a diff. So the contract is to make the divergence READABLE
// and NAMED — never to display it as a comparison, and never to reconcile it.
// ============================================================
import { describe, it, expect } from 'vitest';
import { KNOWLEDGE } from '@marcom/runtime-contracts';
import { VERDICT_AGREEMENT, agreementOf } from './decisionAgreement.js';

describe('C-12 · T11 — agreement is decided by the verdict, and only the verdict', () => {
  it('the same verdict AGREES', () => {
    const a = agreementOf({ live: { verdict: 'KILL', confidence: 0.9 }, stored: { verdict: 'KILL' }, ok: true });
    expect(a).toEqual({ value: VERDICT_AGREEMENT.AGREES, knowledge: KNOWLEDGE.KNOWN });
  });

  it('a different verdict DIVERGES', () => {
    const a = agreementOf({ live: { verdict: 'SCALE' }, stored: { verdict: 'KILL' }, ok: true });
    expect(a).toEqual({ value: VERDICT_AGREEMENT.DIVERGES, knowledge: KNOWLEDGE.KNOWN });
  });

  it('and neither verdict is rewritten by the comparison', () => {
    // "Lumi said KILL" stays true even when today's read says SCALE. The whole
    // reason this is a published FACT rather than a correction.
    const live = { verdict: 'SCALE', confidence: 0.8 };
    const stored = { verdict: 'KILL', confidence: 0.9 };
    agreementOf({ live, stored, ok: true });
    expect(live.verdict).toBe('SCALE');
    expect(stored.verdict).toBe('KILL');
  });
});

describe('C-12 · T12 — R-1: a confidence difference is NOT divergence', () => {
  it('same verdict, very different confidence, still AGREES', () => {
    const a = agreementOf({
      live: { verdict: 'KILL', confidence: 0.51 }, stored: { verdict: 'KILL', confidence: 0.97 }, ok: true,
    });
    expect(a.value).toBe(VERDICT_AGREEMENT.AGREES);
  });

  it('a missing confidence on either side changes nothing', () => {
    // Confidence is not an input here at all. Asserted because the tempting
    // implementation reaches for it, and `?? 0.5` on a null confidence is a
    // defect this repository has already met once.
    const a = agreementOf({ live: { verdict: 'HOLD', confidence: null }, stored: { verdict: 'HOLD' }, ok: true });
    expect(a.value).toBe(VERDICT_AGREEMENT.AGREES);
  });
});

describe('C-12 · T13 — a silence must not read as a finding', () => {
  it('no stored decision is NOTHING_THERE — we looked, and there is none', () => {
    // A campaign can have a live verdict and no stored decision at all: the
    // feed recomputes from the entity graph every read, and Decision rows come
    // only from a sweep. That is a finding about the account, not a failure.
    const a = agreementOf({ live: { verdict: 'KILL' }, stored: null, ok: true });
    expect(a).toEqual({ value: null, knowledge: KNOWLEDGE.NOTHING_THERE });
  });

  it('a FAILED identity read is COULD_NOT_LOOK, never NOTHING_THERE', () => {
    // getLatestDecisions swallows its own failure and returns [] — correct for
    // the button, because the by-entity path still works. Built over silently,
    // it would publish "Lumi has never decided about this campaign": a claim
    // about the ACCOUNT on the strength of OUR failure. C-03's ruling, one
    // object over.
    const a = agreementOf({ live: { verdict: 'KILL' }, stored: null, ok: false });
    expect(a).toEqual({ value: null, knowledge: KNOWLEDGE.COULD_NOT_LOOK });
  });

  it('the two silences are never the same value', () => {
    const missing = agreementOf({ live: { verdict: 'KILL' }, stored: null, ok: true });
    const failed  = agreementOf({ live: { verdict: 'KILL' }, stored: null, ok: false });
    expect(missing.knowledge).not.toBe(failed.knowledge);
  });

  it('a failed read stays COULD_NOT_LOOK even if a stored row somehow arrives', () => {
    // Defensive, and deliberate: `ok:false` means the population we compared
    // against is not the population that exists. A partial answer presented as
    // a whole one is the failure mode, not the missing row.
    const a = agreementOf({ live: { verdict: 'KILL' }, stored: { verdict: 'KILL' }, ok: false });
    expect(a.knowledge).toBe(KNOWLEDGE.COULD_NOT_LOOK);
  });
});

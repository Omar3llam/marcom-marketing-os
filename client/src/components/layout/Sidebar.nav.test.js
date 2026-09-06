// ============================================================
// Sidebar nav copy — one axis, one name (B7 R-N1)
// ------------------------------------------------------------
// SUPERSEDES the earlier assertion that Campaigns' sub-label reads "Decision
// queue". That was true, and it was the problem: the word "Decisions" labelled
// the NOW axis (Overview) while "Decision queue" labelled the SUBJECT axis
// (Campaigns), so one word covered two axes and THEN — which actually owns the
// Decision object — had no name at all. `Sidebar.jsx` had already fought this
// once and settled it by differentiating the sub-labels, which is why the old
// test existed. The axes were what needed separating, not the copy.
//
// B7 R-N1 resolved it: Overview yields the word, THEN takes it.
//
//     Attention   NOW      what needs you now
//     Decisions   THEN     what Lumi decided        ← owns the object
//     Campaigns   SUBJECT  where to investigate
//
// This file now pins the RULING rather than any particular string, so the
// collision cannot quietly return through a copy edit.
//
// Asserted on the exported array rather than a render: Sidebar needs auth, plan
// and router context to mount, none of which this copy depends on.
// ============================================================
import { describe, it, expect } from 'vitest';
import { tools } from './Sidebar.jsx';
import { appRoutes } from '@/app/routeManifest.js';

const byKey = (k) => tools.find((t) => t.key === k);

describe('B7 R-N1 · exactly one nav item may be named for the Decision', () => {
  it('gives the name to THEN, and points it at the Decision destination', () => {
    const decisions = byKey('decisions');
    expect(decisions).toBeTruthy();
    expect(decisions.label).toBe('Decisions');
    expect(decisions.path).toBe(appRoutes.decisions);
  });

  it('no other item claims the word in its LABEL', () => {
    const claimants = tools.filter((t) => /decision/i.test(t.label));
    expect(claimants.map((t) => t.key)).toEqual(['decisions']);
  });

  it('no other item claims it in a SUB-LABEL either', () => {
    // The specific shape of the old collision: "Decisions" above,
    // "Decision queue" below, two axes wearing one word.
    const claimants = tools.filter((t) => t.key !== 'decisions' && /decision/i.test(t.sub ?? ''));
    expect(claimants.map((t) => t.key)).toEqual([]);
  });

  it('Overview is now named for the NOW axis it actually serves', () => {
    const overview = byKey('overview');
    expect(overview.label).toBe('Attention');
    expect(overview.path).toBe(appRoutes.overview);
  });

  it('Campaigns is named as a lens, not as a queue of decisions', () => {
    // R-2 / B7: Campaign is where you LOCATE a Decision, never where it lives.
    expect(/queue/i.test(byKey('campaigns').sub ?? '')).toBe(false);
  });

  it('the Decision destination is ungated by plan — B7 Ruling 3', () => {
    expect(byKey('decisions').plan).toBe('FREE');
  });

  it('no longer says "Verdicts + diagnosis"', () => {
    expect(tools.map((t) => t.sub)).not.toContain('Verdicts + diagnosis');
  });
});

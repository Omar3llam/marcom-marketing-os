// ============================================================
// B8-04b — four temporal facts per belief (B8-05)
// ------------------------------------------------------------
// > since when · how often tested · how often right · what it replaced
//
// Measured on trunk before writing this: THREE of the four already cross the
// wire and none of them renders. `AccountBriefing` shows `accuracy` and
// `status` and stops.
//
//   since when         firstObservedAt   parsed, not rendered
//   how often tested   checks.made       parsed, not rendered   ← C-14 built it
//   how often right    accuracy          RENDERED, with no denominator
//   what it replaced   replacedBy        parsed, not rendered   ← C-14 built it
//
// C-14's headline defect is therefore still LIVE on this surface: `accuracy`
// was "a real ratio with NO denominator — 2/3 and 200/300 both render 67%".
// C-14 made the denominator crossable; nothing rendered it.
//
// ── THE COPY CONSTRAINT THAT IS NOT COSMETIC ────────────────────────────────
// `checks` is published BESIDE accuracy and NEVER as its derivation. Accuracy
// is recency-weighted, so "85%" beside "held 3 of 5" is TWO TRUE FACTS about
// one belief, not an arithmetic error. The surface may not present one as the
// working of the other, and these tests pin that.
//
// Both `checks` and `replacedBy` arrive with their own C-06 knowledge token,
// so an absent one is a measured state, not a blank.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AccountBriefing } from './AccountBriefing.jsx';

const pattern = (over = {}) => ({
  id: 'p1',
  statement: 'KILL calls on fatigued creative hold up',
  kind: 'FATIGUE_CEILING',
  status: 'ESTABLISHED',
  accuracy: 0.85,
  confidence: 0.8,
  support: 5,
  effectiveSupport: 4.2,
  firstObservedAt: new Date('2026-06-01T00:00:00Z'),
  lastObservedAt: new Date('2026-09-01T00:00:00Z'),
  checks: { made: 5, held: 3, knowledge: 'KNOWN' },
  replacedBy: { value: null, knowledge: 'NOTHING_THERE' },
  ...over,
});

const renderBriefing = (patterns) => render(
  <AccountBriefing briefing={{ patterns }} />,
);

beforeEach(() => { vi.clearAllMocks(); });

describe('B8-04b · how often tested — the denominator C-14 made crossable', () => {
  it('states how many checks were made and how many held', () => {
    renderBriefing([pattern()]);
    expect(screen.getByText(/held 3 of 5/i)).toBeInTheDocument();
  });

  it('does NOT present the counts as the derivation of accuracy', () => {
    // 3 of 5 is 60%, and accuracy reads 85% — both true, because accuracy is
    // recency-weighted. Copy that joined them with "=" or "so" would assert an
    // arithmetic relationship that does not exist.
    renderBriefing([pattern()]);
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/85%\s*(=|means|so|i\.e\.)\s*3/i);
    expect(body).not.toMatch(/3 of 5\s*(=|means|so)/i);
  });

  it('says the count is unknown rather than showing zero', () => {
    // A zero would be the claim "never checked". Null means we could not read it.
    renderBriefing([pattern({ checks: { made: null, held: null, knowledge: 'COULD_NOT_LOOK' } })]);
    expect(screen.queryByText(/held 0 of 0/i)).not.toBeInTheDocument();
  });
});

describe('B8-04b · what it replaced — C-14\'s FORWARD edge', () => {
  it('names the belief that replaced this one, as a statement', () => {
    renderBriefing([pattern({
      status: 'SUPERSEDED',
      replacedBy: { value: { id: 'p2', statement: 'KILL only after 21 days' }, knowledge: 'KNOWN' },
    })]);
    expect(screen.getByText(/KILL only after 21 days/)).toBeInTheDocument();
  });

  it('does not claim a replacement when there is none', () => {
    // NOTHING_THERE is a FINDING — we looked, nothing replaced it.
    renderBriefing([pattern()]);
    expect(screen.queryByText(/replaced by/i)).not.toBeInTheDocument();
  });
});

describe('B8-04b · since when, and when last tested', () => {
  it('states when the belief was first observed', () => {
    renderBriefing([pattern()]);
    expect(screen.getByText(/since jun 2026/i)).toBeInTheDocument();
  });

  it('states when it was last tested', () => {
    renderBriefing([pattern()]);
    expect(screen.getByText(/last tested sep 2026/i)).toBeInTheDocument();
  });

  it('omits the dates rather than inventing them', () => {
    renderBriefing([pattern({ firstObservedAt: undefined, lastObservedAt: undefined })]);
    expect(screen.queryByText(/since /i)).not.toBeInTheDocument();
    expect(screen.queryByText(/last tested/i)).not.toBeInTheDocument();
  });
});

describe('B8-04b · how often right stays honest', () => {
  it('still shows the accuracy figure', () => {
    renderBriefing([pattern()]);
    expect(screen.getByText(/85%/)).toBeInTheDocument();
  });

  it('shows a dash, not a figure, when accuracy is null', () => {
    // I54 / R-10: a belief with no measured outcome states none. Null is not 0%.
    // (Already true on trunk — asserted so the temporal row cannot regress it.)
    renderBriefing([pattern({ accuracy: null })]);
    expect(screen.getByText(/right —/)).toBeInTheDocument();
  });
});

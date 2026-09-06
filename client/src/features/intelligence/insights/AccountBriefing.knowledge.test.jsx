// ============================================================
// B8-04b — the knowledge token decides the state, not the value's shape
// ------------------------------------------------------------
// B8-02's ruling: "absence is a MEASURED SEMANTIC STATE, never a UI default.
// The presentation layer may not originate an absence, and may not choose a
// fallback when handed one."
//
// The first cut of this surface broke that. It inferred absence from SHAPE —
// `Number.isFinite(p.checks?.made)` and `p.replacedBy?.value?.statement` — and
// ignored the C-06 token shipped beside each value. Measured against what the
// backend actually emits (`patternHistory.js`), that inference is wrong in a
// way no shape check could catch:
//
//   checks  KNOWN          { made: m,    held: n    }
//           NOTHING_THERE  { made: 0,    held: 0    }   ← isFinite(0) is TRUE
//           COULD_NOT_LOOK { made: null, held: null }
//
//   replacedBy  KNOWN          { value: { id, statement } }
//               NOTHING_THERE  { value: null }
//               COULD_NOT_LOOK { value: null }
//
// So the shape check rendered "held 0 of 0" for NOTHING_THERE — the precise
// string the schema comment forbids, because "a zero would be the claim 'never
// checked'" — and it made COULD_NOT_LOOK and NOTHING_THERE indistinguishable
// for `replacedBy`, collapsing "we could not check" into "nothing replaced it".
//
// THE ASYMMETRY IS DELIBERATE. For `replacedBy`, silence IS the answer when
// nothing replaced the belief: most beliefs were never superseded, and printing
// "nothing replaced this" on every row is noise. But silence may NOT stand for
// COULD_NOT_LOOK, because there silence would assert the finding we failed to
// establish.
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AccountBriefing } from './AccountBriefing.jsx';

const pattern = (over = {}) => ({
  id: 'p1',
  statement: 'KILL calls on fatigued creative hold up',
  kind: 'FATIGUE_CEILING',
  status: 'ESTABLISHED',
  accuracy: 0.85,
  confidence: 0.8,
  checks: { made: 5, held: 3, knowledge: 'KNOWN' },
  replacedBy: { value: null, knowledge: 'NOTHING_THERE' },
  ...over,
});

const renderBriefing = (patterns) => render(<AccountBriefing briefing={{ patterns }} />);

describe('B8-04b · checks — three tokens, three answers', () => {
  it('KNOWN states the counts', () => {
    renderBriefing([pattern()]);
    expect(screen.getByText(/held 3 of 5/i)).toBeInTheDocument();
  });

  it('NOTHING_THERE never renders "held 0 of 0"', () => {
    // The backend really does send made: 0, held: 0 here, so a shape check
    // passes and prints a zero that reads as "we checked and it never held".
    renderBriefing([pattern({ checks: { made: 0, held: 0, knowledge: 'NOTHING_THERE' } })]);
    expect(screen.queryByText(/held 0 of 0/i)).not.toBeInTheDocument();
  });

  it('NOTHING_THERE states the FINDING instead — it has not been checked yet', () => {
    renderBriefing([pattern({ checks: { made: 0, held: 0, knowledge: 'NOTHING_THERE' } })]);
    expect(screen.getByText(/not yet checked/i)).toBeInTheDocument();
  });

  it('COULD_NOT_LOOK says the count could not be read', () => {
    renderBriefing([pattern({ checks: { made: null, held: null, knowledge: 'COULD_NOT_LOOK' } })]);
    expect(screen.getByText(/count unavailable/i)).toBeInTheDocument();
  });

  it('the two absences are DIFFERENT on screen', () => {
    // The whole point. A retry is honest for one and pointless for the other.
    const { container: a } = render(
      <AccountBriefing briefing={{ patterns: [pattern({ checks: { made: 0, held: 0, knowledge: 'NOTHING_THERE' } })] }} />,
    );
    const { container: b } = render(
      <AccountBriefing briefing={{ patterns: [pattern({ checks: { made: null, held: null, knowledge: 'COULD_NOT_LOOK' } })] }} />,
    );
    expect(a.textContent).not.toEqual(b.textContent);
  });
});

describe('B8-04b · replacedBy — silence is an answer for ONE token only', () => {
  it('KNOWN names the belief that replaced this one', () => {
    renderBriefing([pattern({
      replacedBy: { value: { id: 'p2', statement: 'KILL only after 21 days' }, knowledge: 'KNOWN' },
    })]);
    expect(screen.getByText(/KILL only after 21 days/)).toBeInTheDocument();
  });

  it('NOTHING_THERE stays silent — nothing replaced it, and that is the answer', () => {
    renderBriefing([pattern()]);
    expect(screen.queryByText(/replaced by/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn’t check/i)).not.toBeInTheDocument();
  });

  it('COULD_NOT_LOOK does NOT stay silent — silence would assert the finding', () => {
    renderBriefing([pattern({ replacedBy: { value: null, knowledge: 'COULD_NOT_LOOK' } })]);
    expect(screen.getByText(/couldn’t check whether anything replaced/i)).toBeInTheDocument();
  });

  it('an unrecognised token is not treated as KNOWN', () => {
    // Contract drift must not render as a fact. Nothing is claimed either way.
    renderBriefing([pattern({ replacedBy: { value: null, knowledge: 'MAYBE' } })]);
    expect(screen.queryByText(/replaced by/i)).not.toBeInTheDocument();
  });
});

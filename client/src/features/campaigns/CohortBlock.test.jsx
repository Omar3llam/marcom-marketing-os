// ============================================================
// CohortBlock — renders a cohort, owns no vocabulary
// ============================================================
// Same contract as HypothesisBlock and CounterfactualsBlock, with one thing
// neither of those has: `group` arrives ALREADY display-safe. The engine's
// cohort axis is 'awareness' | 'conversion' — its own words, the ones the
// rationale beside this block already uses — not the OUTCOME_* objective enum,
// which has no display map anywhere in the repo. So there is nothing to map, and
// the static check below is what keeps it that way.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CohortBlock } from './CohortBlock.jsx';

const vm = (over = {}) => ({
  rank: 'BOTTOM', group: 'conversion', cohortSize: 8, ctrPct: 0.7, avgCtrPct: 1.5, ...over,
});

describe('what it renders', () => {
  // The one fact the prose rationale never carried: "Lowest CTR in the
  // conversion group" reads identically whether the group held 3 campaigns or
  // 30, and those are very different claims.
  it('how many campaigns this was ranked against, and which group', () => {
    render(<CohortBlock viewModel={vm()} />);
    expect(screen.getByText('Cohort ranking')).toBeInTheDocument();
    expect(screen.getByText('Ranked against 8 campaigns in the conversion group')).toBeInTheDocument();
  });

  it.each([['BOTTOM', 'Bottom quartile'], ['TOP', 'Top quartile']])('names the %s slice', (rank, text) => {
    render(<CohortBlock viewModel={vm({ rank })} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('renders the awareness cohort in the engine’s own word', () => {
    render(<CohortBlock viewModel={vm({ group: 'awareness' })} />);
    expect(screen.getByText(/in the awareness group/)).toBeInTheDocument();
  });

  it('says campaign, not campaigns, for a cohort of one', () => {
    render(<CohortBlock viewModel={vm({ cohortSize: 1 })} />);
    expect(screen.getByText('Ranked against 1 campaign in the conversion group')).toBeInTheDocument();
  });
});

// It names the decision source; it does not restate the evidence. The CTR
// comparison is already in the rationale clause above this block, in the
// engine's own words — printing it again two lines down made one comparison
// look like two, and neither copy could be checked against the other.
describe('it does not repeat the evidence above it', () => {
  it('carries no CTR figures, and no percentages at all', () => {
    const { container } = render(<CohortBlock viewModel={vm()} />);
    expect(container.textContent).not.toMatch(/CTR/);
    expect(container.textContent).not.toMatch(/%/);
    expect(container.textContent).not.toMatch(/group average/);
  });

  // Not dropped from the model, only from this block. They are what the rank was
  // decided on, and a surface with no prose rationale beside it — a feed card, a
  // narrative — will need them.
  it('still accepts them on the view model without rendering them', () => {
    const { container } = render(<CohortBlock viewModel={vm({ ctrPct: 99.9, avgCtrPct: 88.8 })} />);
    expect(container.textContent).not.toMatch(/99|88/);
    expect(screen.getByText(/Ranked against 8 campaigns/)).toBeInTheDocument();
  });

  // The cohort facts are the whole point of the block; losing them to a missing
  // figure nobody prints would be the wrong trade.
  it('renders in full when those figures are absent entirely', () => {
    render(<CohortBlock viewModel={{ rank: 'TOP', group: 'awareness', cohortSize: 5 }} />);
    expect(screen.getByText('Ranked against 5 campaigns in the awareness group')).toBeInTheDocument();
    expect(screen.getByText('Top quartile')).toBeInTheDocument();
  });
});

describe('what it refuses to render', () => {
  // An absolutely-decided verdict has no cohort. An empty card would imply one
  // went missing rather than never existing.
  it.each([[null], [undefined]])('renders nothing for %s', (viewModel) => {
    const { container } = render(<CohortBlock viewModel={viewModel} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('drops the group clause rather than printing "in the  group"', () => {
    const { container } = render(<CohortBlock viewModel={vm({ group: null })} />);
    expect(screen.getByText('Ranked against 8 campaigns')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/in the\s+group/);
  });

  it('drops the quartile line rather than printing an empty one', () => {
    const { container } = render(<CohortBlock viewModel={vm({ rank: null })} />);
    expect(container.textContent).not.toMatch(/quartile/);
    expect(screen.getByText(/Ranked against 8 campaigns/)).toBeInTheDocument();
  });
});

describe('it holds no vocabulary of its own', () => {
  it('renders whatever group word the model carries', () => {
    render(<CohortBlock viewModel={vm({ group: 'ZZ_NOT_A_REAL_COHORT' })} />);
    expect(screen.getByText(/ZZ_NOT_A_REAL_COHORT/)).toBeInTheDocument();
  });

  // The runtime test above passes for a component that imports a map and happens
  // not to hit it. This one fails when the coupling is introduced — including an
  // objective→prose map, which is the tempting wrong turn here: the cohort axis
  // is NOT the objective, and keying off OUTCOME_* would make this block and the
  // sentence above it name the same group two different ways.
  it('imports no label map, no view model, and no objective vocabulary', () => {
    const src = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'CohortBlock.jsx'),
      'utf8',
    );
    const imports = src.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');
    expect(imports).not.toMatch(/REASONING_LABELS|verdictEvidence|ViewModel/);
    expect(src).not.toMatch(/OUTCOME_|require\(/);
  });
});

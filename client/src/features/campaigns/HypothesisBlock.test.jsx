// ============================================================
// HypothesisBlock — renders a view model, owns no vocabulary
// ============================================================
// Same contract as CounterfactualsBlock: it can move to a feed, a narrative or a
// memory timeline only while it knows nothing about enum keys. So the tests hand
// it labels no map could have produced and assert they appear verbatim, and a
// static check fails the moment a label-map import shows up.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HypothesisBlock } from './HypothesisBlock.jsx';

const vm = (over = {}) => ({
  id: 'CREATIVE_FATIGUE',
  label: 'Creative fatigue',
  observed: [
    { key: 'CTR-0', label: 'CTR is below benchmark' },
    { key: 'FREQUENCY-1', label: 'Frequency is above the ceiling' },
  ],
  confidence: { reasoning: 0.8, data: 0.6 },
  ...over,
});

describe('what it renders', () => {
  it('the heading and the mechanism', () => {
    render(<HypothesisBlock viewModel={vm()} />);
    expect(screen.getByText('Why we believe this')).toBeInTheDocument();
    expect(screen.getByText('Creative fatigue')).toBeInTheDocument();
  });

  it('every supporting reading', () => {
    render(<HypothesisBlock viewModel={vm()} />);
    expect(screen.getByText(/CTR is below benchmark/)).toBeInTheDocument();
    expect(screen.getByText(/Frequency is above the ceiling/)).toBeInTheDocument();
  });

  // "Evidence" is a domain object in Lumi: the engine's evidence[] rows carry a
  // value AND the benchmark they were judged against, and the word is doing work
  // elsewhere in this panel. Borrowing it here would imply a rigour this list
  // does not claim.
  it('calls them supporting indicators, not evidence', () => {
    render(<HypothesisBlock viewModel={vm()} />);
    expect(screen.getByText('Supporting indicators:')).toBeInTheDocument();
    expect(screen.queryByText(/^Evidence:?$/)).not.toBeInTheDocument();
  });

  // Carried by the model, shown by nothing — until PR#334.
  it('shows no confidence number yet', () => {
    const { container } = render(<HypothesisBlock viewModel={vm()} />);
    expect(container.textContent).not.toMatch(/0\.8|80%/);
  });
});

describe('what it refuses to render', () => {
  // Null is also how the honesty gate expresses itself: a cohort-decided verdict
  // has no absolute mechanism to show, and an empty box would imply one is
  // missing rather than inapplicable.
  it.each([[null], [undefined]])('renders nothing for %s', (viewModel) => {
    const { container } = render(<HypothesisBlock viewModel={viewModel} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('drops the indicator list rather than showing an empty heading', () => {
    render(<HypothesisBlock viewModel={vm({ observed: [] })} />);
    expect(screen.getByText('Creative fatigue')).toBeInTheDocument();
    expect(screen.queryByText('Supporting indicators:')).not.toBeInTheDocument();
  });

  it('survives a model with no observed list at all', () => {
    expect(() => render(<HypothesisBlock viewModel={vm({ observed: undefined })} />)).not.toThrow();
  });
});

describe('it holds no vocabulary of its own', () => {
  it('renders whatever labels the view model carries', () => {
    render(<HypothesisBlock viewModel={vm({
      label: 'ZZ_NOT_A_REAL_MECHANISM',
      observed: [{ key: 'x-0', label: 'ZZ_NOT_A_REAL_METRIC' }],
    })} />);
    expect(screen.getByText('ZZ_NOT_A_REAL_MECHANISM')).toBeInTheDocument();
    expect(screen.getByText(/ZZ_NOT_A_REAL_METRIC/)).toBeInTheDocument();
  });

  // The runtime test above passes for a component that imports the map and
  // happens not to hit it. This one fails when the coupling is introduced.
  it('imports no label map and no view model', () => {
    const src = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'HypothesisBlock.jsx'),
      'utf8',
    );
    const imports = src.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');
    expect(imports).not.toMatch(/REASONING_LABELS|verdictEvidence|hypothesisViewModel/);
    expect(src).not.toMatch(/require\(/);
  });
});

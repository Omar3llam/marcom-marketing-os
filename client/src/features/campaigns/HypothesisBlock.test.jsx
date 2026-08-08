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
  signalQuality: 'High',
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
  it('calls them key signals, and still not evidence', () => {
    render(<HypothesisBlock viewModel={vm()} />);
    expect(screen.getByText('Key signals:')).toBeInTheDocument();
    expect(screen.queryByText(/Supporting indicators/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Evidence:?$/)).not.toBeInTheDocument();
  });

  // A BAND, never the raw 0.10–0.95. The number is an internal convergence
  // score with no units a marketer could calibrate against, and printing "0.8"
  // beside a percentage-heavy panel invites reading it as one.
  it('shows the band and never the number behind it', () => {
    const { container } = render(<HypothesisBlock viewModel={vm()} />);
    expect(screen.getByText('Signal quality: High')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/0\.8|80%/);
  });

  // "Signal strength" and "weak signal" both read as a verdict on the campaign.
  // This is a statement about the evidence FOR the verdict.
  it('calls it signal quality, not strength and not weakness', () => {
    const { container } = render(<HypothesisBlock viewModel={vm({ signalQuality: 'Low' })} />);
    expect(screen.getByText('Signal quality: Low')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[Ss]ignal strength|[Ww]eak signal/);
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

  // The model returns null when the hypothesis carried no readable reasoning
  // score. An empty "Signal quality:" would claim we measured something.
  it.each([[null], [undefined]])('drops the signal-quality line for %s', (signalQuality) => {
    render(<HypothesisBlock viewModel={vm({ signalQuality })} />);
    expect(screen.getByText('Creative fatigue')).toBeInTheDocument();
    expect(screen.queryByText(/Signal quality/)).not.toBeInTheDocument();
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

  // Including the band. If this component ever grew its own thresholds, a made-up
  // band would be normalised away instead of printed — and the panel header and
  // this card would start disagreeing about the same scale.
  it('prints whatever band the model banded, holding no thresholds of its own', () => {
    render(<HypothesisBlock viewModel={vm({ signalQuality: 'ZZ_NOT_A_REAL_BAND' })} />);
    expect(screen.getByText('Signal quality: ZZ_NOT_A_REAL_BAND')).toBeInTheDocument();
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

// ============================================================
// CounterfactualsBlock — a pure renderer, and the proof that it is one
// ============================================================
// The value of this component being dumb is that it can move: onto the feed, a
// memory timeline, a narrative, without dragging the reasoning vocabulary with
// it. That only holds while it knows nothing about enum keys — so the tests feed
// it labels that could not have come from any map, and assert it renders them.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CounterfactualsBlock } from './CounterfactualsBlock.jsx';

const vm = (over = {}) => [{
  mechanism: 'AUDIENCE_MISMATCH',
  label: 'Audience mismatch',
  rejectedBy: [{ key: 'CPC-0', label: 'Cost per click was acceptable' }],
  preferredBecause: [{ key: 'CTR-0', label: 'CTR is below benchmark' }],
  ...over,
}];

describe('what it renders', () => {
  it('the heading and the mechanism label', () => {
    render(<CounterfactualsBlock viewModel={vm()} />);
    expect(screen.getByText('What we ruled out')).toBeInTheDocument();
    expect(screen.getByText('Audience mismatch')).toBeInTheDocument();
  });

  it('both evidence lists under their own headings', () => {
    render(<CounterfactualsBlock viewModel={vm()} />);
    expect(screen.getByText('Ruled out because:')).toBeInTheDocument();
    expect(screen.getByText(/Cost per click was acceptable/)).toBeInTheDocument();
    expect(screen.getByText('The primary explanation also covers:')).toBeInTheDocument();
    expect(screen.getByText(/CTR is below benchmark/)).toBeInTheDocument();
  });

  it('every counterfactual it is handed', () => {
    render(<CounterfactualsBlock viewModel={[
      ...vm(),
      ...vm({ mechanism: 'LOW_CTR', label: 'Low click-through rate' }),
    ]} />);
    expect(screen.getByText('Audience mismatch')).toBeInTheDocument();
    expect(screen.getByText('Low click-through rate')).toBeInTheDocument();
  });
});

describe('what it refuses to render', () => {
  // "We ruled nothing out" is not a finding. An empty bordered box reads as a
  // failed load, which is the opposite of what happened.
  it.each([[null], [undefined], [[]]])('renders nothing for %s', (viewModel) => {
    const { container } = render(<CounterfactualsBlock viewModel={viewModel} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('omits an empty list rather than showing an empty heading', () => {
    render(<CounterfactualsBlock viewModel={vm({ rejectedBy: [] })} />);
    expect(screen.queryByText('Ruled out because:')).not.toBeInTheDocument();
    // …while the other half still renders.
    expect(screen.getByText('The primary explanation also covers:')).toBeInTheDocument();
  });
});

describe('it holds no vocabulary of its own', () => {
  // The property, stated as a test rather than a comment: hand it labels no map
  // could produce, and they appear verbatim. If this component ever grew its own
  // lookup, these strings would be replaced or dropped.
  it('renders whatever labels the view model carries', () => {
    render(<CounterfactualsBlock viewModel={vm({
      label: 'ZZ_NOT_A_REAL_MECHANISM',
      rejectedBy: [{ key: 'x-0', label: 'ZZ_NOT_A_REAL_METRIC' }],
      preferredBecause: [],
    })} />);
    expect(screen.getByText('ZZ_NOT_A_REAL_MECHANISM')).toBeInTheDocument();
    expect(screen.getByText(/ZZ_NOT_A_REAL_METRIC/)).toBeInTheDocument();
  });

  // Enforced statically too. The runtime test above passes for a component that
  // imports the map and happens not to hit it; this one fails the moment the
  // import appears, which is when the coupling is actually introduced.
  it('imports no label map and no view model', () => {
    const src = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'CounterfactualsBlock.jsx'),
      'utf8',
    );
    // Import STATEMENTS only — the header comment names both modules on purpose,
    // to say who owns the vocabulary this one deliberately lacks.
    const imports = src.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');
    expect(imports).not.toMatch(/REASONING_LABELS|verdictEvidence|counterfactualViewModel/);
    // And no lazy require either.
    expect(src).not.toMatch(/require\(/);
  });

  it('uses the key the view model supplied', () => {
    // A React key cannot be read back from the DOM, so this asserts the shape
    // the renderer consumes: `key` on each line, not a positional index.
    const lines = vm()[0].rejectedBy;
    expect(lines[0]).toHaveProperty('key');
    render(<CounterfactualsBlock viewModel={vm()} />);
    expect(screen.getByText(/Cost per click was acceptable/)).toBeInTheDocument();
  });

  it('survives a counterfactual with no mechanism to key on', () => {
    const { container } = render(<CounterfactualsBlock viewModel={vm({ mechanism: null })} />);
    expect(container).not.toBeEmptyDOMElement();
    expect(screen.getByText('Audience mismatch')).toBeInTheDocument();
  });
});

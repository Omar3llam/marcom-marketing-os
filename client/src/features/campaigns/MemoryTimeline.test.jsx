// ============================================================
// MemoryTimeline — renders a view model, owns no vocabulary
// ============================================================
// Same contract as HypothesisBlock, CounterfactualsBlock and CohortBlock: it can
// move to a feed, a narrative or a leadership report only while it knows nothing
// about enums, outcomes or how to fetch anything. The static check at the bottom
// is what keeps that true after the next person edits it.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MemoryTimeline } from './MemoryTimeline.jsx';

const row = (over = {}) => ({
  key: 'd1', verdict: 'KILL', action: 'Executed', at: '1 Aug', outcome: null, ...over,
});
const vm = (over = {}) => ({ count: 1, items: [row()], ...over });

describe('what it renders', () => {
  it('the heading and the count', () => {
    render(<MemoryTimeline viewModel={vm({ count: 3 })} />);
    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.getByText('Seen 3 times')).toBeInTheDocument();
  });

  it('says time, not times, for one', () => {
    render(<MemoryTimeline viewModel={vm({ count: 1 })} />);
    expect(screen.getByText('Seen 1 time')).toBeInTheDocument();
  });

  // The count is the service's true total and can exceed the listed rows.
  it('prints the count it was given even when fewer rows travelled', () => {
    render(<MemoryTimeline viewModel={{ count: 9, items: [row(), row({ key: 'd2' })] }} />);
    expect(screen.getByText('Seen 9 times')).toBeInTheDocument();
  });

  it('the historical verdict, what was done, and when', () => {
    render(<MemoryTimeline viewModel={vm()} />);
    expect(screen.getByText('KILL')).toBeInTheDocument();
    expect(screen.getByText(/Executed/)).toBeInTheDocument();
    expect(screen.getByText(/1 Aug/)).toBeInTheDocument();
  });

  it('every row it was handed, in order', () => {
    const { container } = render(<MemoryTimeline viewModel={{
      count: 3,
      items: [row({ key: 'a', verdict: 'KILL' }), row({ key: 'b', verdict: 'SCALE' }), row({ key: 'c', verdict: 'HOLD' })],
    }} />);
    const t = container.textContent;
    expect(t.indexOf('KILL')).toBeLessThan(t.indexOf('SCALE'));
    expect(t.indexOf('SCALE')).toBeLessThan(t.indexOf('HOLD'));
  });

  it('the outcome, when one was recorded', () => {
    render(<MemoryTimeline viewModel={vm({ items: [row({ outcome: 'Improved after' })] })} />);
    expect(screen.getByText('Improved after')).toBeInTheDocument();
  });
});

describe('what it refuses to render', () => {
  // Null is the honest state for a campaign we have never judged: "Seen 0 times"
  // claims we looked and found none.
  it.each([[null], [undefined]])('renders nothing for %s', (viewModel) => {
    const { container } = render(<MemoryTimeline viewModel={viewModel} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('never prints a zero', () => {
    const { container } = render(<MemoryTimeline viewModel={null} />);
    expect(container.textContent).not.toMatch(/Seen 0/);
  });

  // An absent line is "we do not know yet". A placeholder reads as a measurement.
  it('drops the outcome line rather than filling it in', () => {
    const { container } = render(<MemoryTimeline viewModel={vm({ items: [row({ outcome: null })] })} />);
    expect(container.textContent).not.toMatch(/not recorded|unknown|n\/a|—/i);
  });

  it('drops the date rather than printing an empty separator', () => {
    const { container } = render(<MemoryTimeline viewModel={vm({ items: [row({ at: null })] })} />);
    expect(container.textContent).not.toMatch(/·\s*$/);
    expect(screen.getByText('KILL')).toBeInTheDocument();
  });
});

// ============================================================
// C-03 — the unavailable state
// ============================================================
// The renderer stays vocabulary-free: the sentence arrives already worded, the
// way verdict, action and outcome do. What it owns is the SHAPE — that an
// unreadable history prints a notice and never a number.
describe('C-03 · when the history could not be read', () => {
  const NOTICE = 'Decision history could not be loaded';
  const unavailable = { unavailable: true, notice: NOTICE };

  it('renders the notice under the Memory heading', () => {
    render(<MemoryTimeline viewModel={unavailable} />);
    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
  });

  // THE POINT. Any count would say we counted; a zero would say we looked and
  // found none. Both are claims about the campaign, made when the only thing we
  // know is a fact about ourselves.
  it('prints no count, and above all no zero', () => {
    const { container } = render(<MemoryTimeline viewModel={unavailable} />);
    expect(screen.queryByText(/Seen/)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d/);
  });

  it('takes the sentence from the view model, never from itself', () => {
    render(<MemoryTimeline viewModel={{ unavailable: true, notice: 'Custom wording' }} />);
    expect(screen.getByText('Custom wording')).toBeInTheDocument();
  });

  // Unchanged, and deliberately: no view model at all is still nothing at all.
  // That is the OK-with-no-history case, silent by ruling.
  it('still renders nothing for a null view model', () => {
    const { container } = render(<MemoryTimeline viewModel={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('it holds no vocabulary, no state, and no data access', () => {
  it('renders whatever labels the view model carries', () => {
    render(<MemoryTimeline viewModel={vm({
      items: [row({ verdict: 'ZZ_NOT_A_VERDICT', action: 'ZZ_NOT_AN_ACTION', outcome: 'ZZ_NOT_AN_OUTCOME' })],
    })} />);
    expect(screen.getByText('ZZ_NOT_A_VERDICT')).toBeInTheDocument();
    expect(screen.getByText(/ZZ_NOT_AN_ACTION/)).toBeInTheDocument();
    expect(screen.getByText('ZZ_NOT_AN_OUTCOME')).toBeInTheDocument();
  });

  // The runtime tests above pass for a component that imports a service and
  // happens not to call it. This one fails when the coupling is introduced.
  it('imports no service, no view model, no API client and no label map', () => {
    const src = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'MemoryTimeline.jsx'),
      'utf8',
    );
    const imports = src.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');
    expect(imports).not.toMatch(/DecisionMemoryService|decisionHistory|memoryTimelineViewModel|verdictEvidence|api|client|prisma/i);
    expect(src).not.toMatch(/require\(|useState|useEffect|fetch\(/);
  });

  // Fix 8's rule, as a test: bounding is the service's job, so a slice here
  // would silently hide rows the count still claims.
  it('slices nothing', () => {
    const src = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'MemoryTimeline.jsx'),
      'utf8',
    );
    expect(src).not.toMatch(/\.slice\(|\.filter\(|\.sort\(/);
  });
});

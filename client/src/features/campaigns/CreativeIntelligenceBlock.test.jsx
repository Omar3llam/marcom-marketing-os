// ============================================================
// CreativeIntelligenceBlock — renders a view model, owns no judgement
// ============================================================
// Same contract as HypothesisBlock, CohortBlock and MemoryTimeline: it can move
// to a report, a card or a narrative only while it knows nothing about
// rankings, thresholds or how to fetch anything. The static check at the bottom
// is what keeps that true after the next edit.
//
// The behavioural half is about absences. A missing metric must render "—" and
// a missing creative age must render "Unknown" — because a 0 and a "new" are
// both readings a marketer would act on, and neither was measured.
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CreativeIntelligenceBlock } from './CreativeIntelligenceBlock.jsx';

const codeOf = () => readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'CreativeIntelligenceBlock.jsx'), 'utf8',
);

const vm = (over = {}) => ({
  ad: {
    id: 'ad-2', name: 'Hook A · 9x16', channel: 'META', status: 'ACTIVE',
    platformCreatedTime: '2026-06-14T08:30:00.000Z', creativeAge: '14 Jun 2026',
  },
  metrics: {
    ctr: 0.0091, roas: 1.4, frequency: 3.9, spendMinor: 122_500, currency: 'USD',
    impressions: 42_000, clicks: 382, conversions: 6,
  },
  videoSignals: { videoView: 4000, video25: 1800, video50: 900, video95: 300 },
  ranking: {
    rank: 'BOTTOM', comparedCount: 4, metric: 'ctr', metricLabel: 'CTR',
    gapPercent: -34, label: 'CTR 34% below the ad set within 4 reporting ads',
  },
  comparison: { metricLabel: 'CTR', childValue: '0.91%', parentValue: '2.00%', gap: '-34%', relation: '34% below ad set' },
  ...over,
});

describe('P7-04B comparison hierarchy', () => {
  it('privileges the ranking metric and keeps unrelated reported metrics under Context', () => {
    render(<CreativeIntelligenceBlock viewModel={vm()} />);
    const primary = screen.getByRole('region', { name: 'Selected comparison' });
    expect(within(primary).getByText('CTR')).toBeInTheDocument();
    expect(within(primary).getByText('0.91%')).toBeInTheDocument();
    expect(within(primary).getByText('2.00%')).toBeInTheDocument();
    expect(within(primary).getByText('-34%')).toBeInTheDocument();
    expect(within(primary).getByText('34% below ad set')).toBeInTheDocument();
    expect(within(primary).queryByText('ROAS')).not.toBeInTheDocument();
    const context = screen.getByRole('region', { name: 'Context' });
    expect(within(context).getByText('ROAS')).toBeInTheDocument();
    expect(within(context).getByText('Frequency')).toBeInTheDocument();
    expect(within(context).queryByText('CTR')).not.toBeInTheDocument();
  });
});

describe('what it renders', () => {
  it('the heading and the ad it is about', () => {
    render(<CreativeIntelligenceBlock viewModel={vm()} />);
    expect(screen.getByText('Creative intelligence')).toBeInTheDocument();
    expect(screen.getByText('Hook A · 9x16')).toBeInTheDocument();
  });

  it('the creative age, as a real date', () => {
    render(<CreativeIntelligenceBlock viewModel={vm()} />);
    expect(screen.getByText(/Creative age/)).toBeInTheDocument();
    expect(screen.getByText(/14 Jun 2026/)).toBeInTheDocument();
  });

  it('the server’s finding, verbatim', () => {
    render(<CreativeIntelligenceBlock viewModel={vm()} />);
    expect(screen.getByText('CTR 34% below the ad set within 4 reporting ads')).toBeInTheDocument();
  });

  it('the real CTR, ROAS and frequency', () => {
    render(<CreativeIntelligenceBlock viewModel={vm()} />);
    expect(screen.getByText('0.91%')).toBeInTheDocument();
    expect(screen.getByText('1.40x')).toBeInTheDocument();
    expect(screen.getByText('3.90')).toBeInTheDocument();
  });

  it('the video signals that were reported', () => {
    render(<CreativeIntelligenceBlock viewModel={vm()} />);
    expect(screen.getByText('Video signals')).toBeInTheDocument();
    expect(screen.getByText('4,000')).toBeInTheDocument();
    expect(screen.getByText('1,800')).toBeInTheDocument();
    expect(screen.getByText('95% watched')).toBeInTheDocument();
  });

  it('only the video signals the view model carried', () => {
    render(<CreativeIntelligenceBlock viewModel={vm({ videoSignals: { videoView: 500 } })} />);
    expect(screen.getByText('Video views')).toBeInTheDocument();
    expect(screen.queryByText('25% watched')).not.toBeInTheDocument();
    expect(screen.queryByText('95% watched')).not.toBeInTheDocument();
  });

  it('a video key it has no name for, under its own key', () => {
    render(<CreativeIntelligenceBlock viewModel={vm({ videoSignals: { video75: 640 } })} />);
    expect(screen.getByText('video75')).toBeInTheDocument();
    expect(screen.getByText('640')).toBeInTheDocument();
  });
});

describe('what it refuses to render', () => {
  it.each([[null], [undefined], [{}], [{ ad: null }]])('renders nothing for %s', (viewModel) => {
    const { container } = render(<CreativeIntelligenceBlock viewModel={viewModel} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each(['ctr', 'roas', 'frequency'])('a missing %s renders a dash, never a zero', (field) => {
    render(<CreativeIntelligenceBlock viewModel={vm({
      metrics: { ...vm().metrics, [field]: null },
      comparison: field === 'ctr' ? { ...vm().comparison, childValue: null } : vm().comparison,
    })} />);
    expect(screen.getAllByLabelText('No data').length).toBeGreaterThan(0);
  });

  it('never prints 0.00% for an unreported CTR', () => {
    const { container } = render(<CreativeIntelligenceBlock viewModel={vm({
      metrics: { ...vm().metrics, ctr: null },
      comparison: { ...vm().comparison, childValue: null },
    })} />);
    expect(container.textContent).not.toMatch(/0\.00%/);
  });

  // The one wrong answer a fatigue reader would act on.
  it('an unknown creative age reads Unknown, never "new"', () => {
    const { container } = render(<CreativeIntelligenceBlock viewModel={vm({
      ad: { ...vm().ad, creativeAge: null },
    })} />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\bnew\b/i);
  });

  it('drops the whole video section when nothing was reported', () => {
    render(<CreativeIntelligenceBlock viewModel={vm({ videoSignals: null })} />);
    expect(screen.queryByText('Video signals')).not.toBeInTheDocument();
  });

  it('drops the finding line rather than printing an empty one', () => {
    const { container } = render(<CreativeIntelligenceBlock viewModel={vm({
      ranking: { ...vm().ranking, label: null },
    })} />);
    expect(container.textContent).not.toMatch(/undefined|null/);
    expect(screen.getByText('Hook A · 9x16')).toBeInTheDocument();
  });

  // Fix 11. The engine ranks ads; it does not judge them. A block that turned
  // "furthest behind" into an instruction would be inventing the one thing the
  // ad level has no verdict for.
  it('recommends nothing — evidence is not a verdict', () => {
    const { container } = render(<CreativeIntelligenceBlock viewModel={vm()} />);
    expect(container.textContent).not.toMatch(/kill|pause|refresh this|replace this|recommend/i);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('it holds no vocabulary, no state, and no data access', () => {
  it('renders whatever the view model says, without checking it', () => {
    render(<CreativeIntelligenceBlock viewModel={vm({
      ranking: { ...vm().ranking, label: 'ZZ_NOT_A_FINDING' },
      ad: { ...vm().ad, name: 'ZZ_NOT_A_NAME', creativeAge: 'ZZ_NOT_A_DATE' },
    })} />);
    expect(screen.getByText('ZZ_NOT_A_FINDING')).toBeInTheDocument();
    expect(screen.getByText('ZZ_NOT_A_NAME')).toBeInTheDocument();
    expect(screen.getByText(/ZZ_NOT_A_DATE/)).toBeInTheDocument();
  });

  // The runtime tests pass for a component that imports a hook and happens not
  // to call it. This one fails when the coupling is introduced.
  it('imports no hook, no view model, no API client and no engine constant', () => {
    const imports = codeOf().split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');
    expect(imports).not.toMatch(/useEvidence|creativeIntelligenceViewModel|executionContext|verdictEvidence|api|hooks/i);
    expect(codeOf()).not.toMatch(/useState|useEffect|useMemo|fetch\(|require\(/);
  });

  it('ranks, sorts and filters nothing', () => {
    // Entries() over a bag the view model already narrowed is the only traversal
    // here — a sort or a filter would mean this component decided what to show.
    expect(codeOf()).not.toMatch(/\.sort\(|\.filter\(|\.slice\(/);
  });

  it('holds no threshold and no benchmark of its own', () => {
    const code = codeOf().replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/minGap|threshold|benchmark|SEVERITY|healthy|weak/i);
  });

  it('has no click handler — nothing here is an action', () => {
    expect(codeOf()).not.toMatch(/onClick|onChange|onSubmit/);
  });
});

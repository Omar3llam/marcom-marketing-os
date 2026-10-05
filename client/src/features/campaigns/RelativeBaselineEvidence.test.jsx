import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { RelativeBaselineEvidence } from './RelativeBaselineEvidence.jsx';
import { buildRelativeBaselineReadout } from './executionContext.js';

const envelope = (over = {}) => ({
  source: 'META', windowStart: '2026-08-01T12:30:00.000Z', windowEnd: '2026-08-30T18:45:00.000Z',
  currency: null, comparableCount: 2, excludedByEnvelopeCount: 1, ...over,
});
const nouns = { subjectLabel: 'Ad', parentLabel: 'Ad set', relationParentLabel: 'ad set', populationNoun: 'ads' };
const source = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');

describe('P7-07B admitted relative-baseline readout', () => {
  it.each([
    ['ctr', 0.0091, 0.02, -0.34, 'CTR', '0.91%', '2.00%', '-34%', '34% below ad set'],
    ['roas', 1.4, 2, -0.34, 'ROAS', '1.40x', '2.00x', '-34%', '34% below ad set'],
    ['frequency', 4.2, 2, 0.42, 'Frequency', '4.20', '2.00', '+42%', '42% above ad set'],
  ])('%s preserves the published gap, units and basis',
    (metric, subjectValue, parentValue, gap, metricLabel, childText, parentText, signed, relation) => {
      const readout = buildRelativeBaselineReadout({ ...nouns, metric, subjectValue, parentValue, gap,
        comparisonEnvelope: envelope({ currency: metric === 'roas' ? 'EGP' : null }) });
      render(<RelativeBaselineEvidence readout={readout} />);
      const region = screen.getByRole('region', { name: 'Selected comparison' });
      for (const text of [metricLabel, childText, parentText, signed, relation]) {
        expect(within(region).getByText(text)).toBeInTheDocument();
      }
      expect(within(region).getByText(/2026-08-01T12:30:00.000Z.*2026-08-30T18:45:00.000Z.*META/)).toBeInTheDocument();
      expect(within(region).getByText(/2 reporting ads.*1 excluded from this comparison/)).toBeInTheDocument();
      expect(region.querySelector('[class*="signal-"]')).toBeNull();
      expect(region.textContent).not.toMatch(/good|bad|improv|kill|scale/i);
      if (metric === 'roas') expect(within(region).getByText(/META · EGP/)).toBeInTheDocument();
    });

  it('preserves labelled subject-before-parent reading order', () => {
    render(<RelativeBaselineEvidence readout={buildRelativeBaselineReadout({ ...nouns,
      metric: 'ctr', subjectValue: 0.0091, parentValue: 0.02, gap: -0.34, comparisonEnvelope: envelope() })} />);
    const region = screen.getByRole('region', { name: 'Selected comparison' });
    expect([...region.querySelectorAll('dt')].map(node => node.textContent)).toEqual(['Ad', 'Ad set']);
    expect([...region.querySelectorAll('dd')].map(node => node.textContent)).toEqual(['0.91%', '2.00%']);
    const text = region.textContent;
    expect(text.indexOf('34% below ad set')).toBeLessThan(text.indexOf('Evidence ·'));
    expect(text.indexOf('Evidence ·')).toBeLessThan(text.indexOf('Compared within'));
  });

  it('converges only the inner readout in both consumers', () => {
    for (const file of ['./ExecutionContext.jsx', './CreativeIntelligenceBlock.jsx']) {
      const code = source(file);
      expect(code).toMatch(/<RelativeBaselineEvidence\s+readout=/);
      expect(code).not.toMatch(/<dl\b/);
    }
    expect(source('./creativeIntelligenceViewModel.js')).toMatch(/buildRelativeBaselineReadout\(/);
    expect(source('./ExecutionContext.jsx')).toMatch(/buildRelativeBaselineReadout\(/);
  });

  it('has an AVAILABLE-only, formatted-content API with no domain dependencies or small text', () => {
    const code = source('./RelativeBaselineEvidence.jsx').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
    expect(code).toMatch(/function RelativeBaselineEvidence\(\{ readout \}\)/);
    expect(code).not.toMatch(/loading|error|reasonKey|fallback|isPartial|showUnavailable|mode|dimension|showRanking|showSpend|showActions/);
    expect(code).not.toMatch(/\bimport\b|\?\?|<Dash|\.sort\(|ranked|summary|sampleSize|minGap|currencyProvenance|fetch\(/);
    expect(code).not.toMatch(/text-\[(?:10|11)px\]|text-xs|text-lumi-subtle|signal-/);
    expect(code.split('\n').length).toBeLessThan(150);
  });
});

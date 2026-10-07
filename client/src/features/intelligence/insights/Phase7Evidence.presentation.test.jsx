// Compile the real feature utilities against the current Tailwind configuration.
// JSDOM does not resolve inherited font-size, so walk the actual computed styles
// to the first declared ancestor. Real viewport geometry is checked in the
// accompanying browser verification; these tests do not claim layout support.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resolve } from 'node:path';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig';
import { PerformanceChart } from '@/components/campaign-analysis/PerformanceChart.jsx';
import { ProofView } from '@/features/intelligence/proof/ProofView.jsx';
import { ConnectionsView } from '@/features/connectors/ConnectorsView.jsx';
import ConnectionHealthStrip from '@/features/overview/components/ConnectionHealthStrip.jsx';
import { FatigueForecastPanel } from './FatigueForecastPanel.jsx';
import { useFatigueForecast } from '@/hooks/useFatigueForecast.js';
import { api } from '@/api/client';
import { formatCurrency } from '@/lib/money';
import { ConnectionsResponseSchema } from '@/contracts/schemas';
import { DecisionAccuracySchema } from '@/contracts/schemas/accuracy.schema';
import { calculateDecisionAccuracy } from '../../../../../src/services/decision-accuracy/decisionAccuracyEngine.js';
import { accuracySurface } from '../../../../../src/services/decision-accuracy/accuracyTypes.js';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));
vi.mock('@/hooks/useConnections.js', () => ({ useConnections: () => ({ data: null, loading: false, error: null }) }));
vi.mock('@/hooks/useProjectId.js', () => ({ useProjectId: () => ({ projectId: 'ws' }) }));

let stylesheet;
beforeAll(async () => {
  const files = ['components/campaign-analysis/PerformanceChart.jsx', 'features/intelligence/proof/ProofView.jsx',
    'features/connectors/ConnectorsView.jsx', 'features/overview/components/ConnectionHealthStrip.jsx',
    'features/intelligence/insights/FatigueForecastPanel.jsx'];
  const config = loadConfig(resolve('tailwind.config.js'));
  const css = await postcss([tailwind({ ...config, content: files.map(file => resolve(`src/${file}`)) })])
    .process('@tailwind utilities;', { from: undefined });
  stylesheet = document.createElement('style');
  stylesheet.textContent = css.css;
  document.head.append(stylesheet);
});
afterAll(() => stylesheet?.remove());
beforeEach(() => vi.clearAllMocks());

function evidenceSize(element) {
  for (let node = element; node; node = node.parentElement) {
    const size = getComputedStyle(node).fontSize;
    if (size.endsWith('px')) return parseFloat(size);
  }
  throw new Error('Evidence had no resolvable font size');
}
function readable(elements) {
  for (const element of elements) expect(evidenceSize(element), element.textContent).toBeGreaterThanOrEqual(12);
}
const view = element => render(<MemoryRouter>{element}</MemoryRouter>);
const at = '2026-10-07T12:00:00Z';
const connections = () => ConnectionsResponseSchema.parse({ workspaceId: 'ws', connections: [{
  platform: 'META', connected: true, isActive: true, stale: true, connection: 'CONNECTED', readiness: 'STALE',
  availability: 'FAILING', completeness: 'INCOMPLETE', readinessKnowledge: 'KNOWN',
  availabilityKnowledge: 'KNOWN', completenessKnowledge: 'KNOWN', lastSuccessfulSync: '2026-10-04T12:00:00Z',
}] });
const proof = () => calculateDecisionAccuracy({ now: new Date(at), decisions: Array.from({ length: 60 }, (_, i) => ({
  id: `d${i}`, accuracyStatus: 'EXECUTED', verdict: 'KILL', confidence: .85, createdAt: '2026-04-20T18:00:00Z',
  outcome: { sustained: true, spendDeltaMinor: 100, windowEnd: '2026-06-01' },
})) });
const fatigue = overrides => ({ entityId: 'c1', name: 'Measured campaign', channel: 'META', currentFrequency: 3.1,
  velocity: null, daysUntilSaturation: null, status: 'STABLE', reach: 10000, exhaustionPct: 89, ...overrides });

describe('Phase 7 compiled-CSS evidence readability', () => {
  it('keeps available spend amounts, zero/nonzero shares and population at least 12px', () => {
    view(<PerformanceChart budgetDistribution={{ status: 'AVAILABLE', currency: 'EGP', totalSpendMinor: 100000,
      killSpendMinor: 0, holdSpendMinor: 75010, scaleSpendMinor: 24990, killPct: 0, holdPct: 75.01, scalePct: 24.99 }} />);
    readable(['Kill', 'Hold / Watch / Reallocate / Refresh', 'Scale', '0%', '75.01%', '24.99%', 'EGP',
      'Total scored spend', 'Positive spend on campaigns with a current LUMI verdict.',
      ...[0, 75010, 24990, 100000].map(value => formatCurrency(value, 'EGP'))]
      .map(text => screen.getByText(text, { normalizer: value => value })));
  });
  it('keeps admitted calibration and cohort interpretation readable without altering bins', () => {
    const data = proof();
    const admitted = DecisionAccuracySchema.parse(data);
    view(<ProofView data={admitted} surface={accuracySurface(data)} />);
    readable([screen.getByText(/Brier:/), screen.getByText(/Direction:/), screen.getByText(/Accuracy \(secondary\):/),
      screen.getByText(/Calibration error \(ECE\)/), screen.getByText(/The trend uses only cohorts/),
      screen.getByText('Cohort values can update as outcomes mature.')]);
    const records = screen.getByRole('region', { name: 'Reliability evidence records' });
    expect(within(records).getAllByRole('article')).toHaveLength(admitted.calibration.bins.length);
    expect(records).toHaveTextContent('Actually right'); expect(records).toHaveTextContent('0%');
    expect(records).toHaveTextContent('60');
  });
  it('keeps Channels source facts and identity readable', () => {
    view(<ConnectionsView connections={connections().connections} />);
    readable([screen.getByText('Meta Ads'), screen.getByText(/Stale · Last successful sync/),
      screen.getByText('Latest sync attempt failed'), screen.getByText('Last successful sync was incomplete')]);
  });
  it.each([true, false])('keeps Overview compact=%s provider and independent facts readable', compact => {
    view(<ConnectionHealthStrip compact={compact} state={{ data: connections(), loading: false, error: null }} />);
    readable([screen.getByText('Meta'), screen.getByText(/Stale · Last successful sync/),
      screen.getByText('Latest sync attempt failed'), screen.getByText('Last successful sync was incomplete'),
      screen.getByText('Not connected')]);
  });
  it('keeps fatigue measurements, published status and server ceiling readable', () => {
    view(<FatigueForecastPanel forecast={[fatigue()]} frequencyCeiling={3.5} />);
    readable([screen.getByText(/META · freq/), screen.getByText(/89% of ceiling/), screen.getByText('stable'),
      screen.getByText(/Saturation threshold:/)]);
  });
});

describe('fatigue ratio and record preserve published facts', () => {
  it.each([
    ['STABLE', 89, null, 'stable', 'text-lumi-muted'],
    ['AT_RISK', 75, 6, '~6 days', 'text-signal-watch'],
    ['SATURATED', 100, 0, 'saturated now', 'text-signal-kill'],
  ])('keeps %s state separate from %s%% through the real fatigue hook', async (status, exhaustionPct, daysUntilSaturation, label, statusClass) => {
    api.get.mockResolvedValue({ data: { forecast: [fatigue({ status, exhaustionPct, daysUntilSaturation })], frequencyCeiling: 3.5 } });
    function Read() { const s = useFatigueForecast(); return <FatigueForecastPanel forecast={s.forecast} frequencyCeiling={s.frequencyCeiling} loading={s.isLoading} error={s.error} />; }
    view(<Read />);
    const ratio = await screen.findByText(new RegExp(`${exhaustionPct}% of ceiling`));
    expect(ratio.className).not.toMatch(/signal-(kill|watch|scale|hold)/);
    expect(screen.getByText(label).parentElement).toHaveClass(statusClass);
    expect(screen.getByText(/Saturation threshold:/)).toHaveTextContent('3.5');
  });
  it.each([0, 59, 60, 84, 85, 89, 100])('keeps the measured %s percent neutral without deriving a status', exhaustionPct => {
    view(<FatigueForecastPanel forecast={[fatigue({ exhaustionPct })]} frequencyCeiling={3.5} />);
    expect(screen.getByText(new RegExp(`${exhaustionPct}% of ceiling`)).className).not.toMatch(/signal-(kill|watch|scale|hold)/);
    expect(screen.getByText('stable')).toBeInTheDocument();
  });
  it('retains long evidence, nullable facts and the native campaign deep link without truncation', () => {
    const name = 'Long measured campaign identity '.repeat(6);
    const channel = 'LONG_CHANNEL_WITH_SOURCE_IDENTITY'.repeat(4);
    view(<FatigueForecastPanel forecast={[fatigue({ name, channel, velocity: .012, reach: 999999999999999, status: 'AT_RISK', daysUntilSaturation: 6 })]} frequencyCeiling={3.5} />);
    const link = screen.getByRole('link', { name: /Long measured campaign/ });
    expect(link).toHaveAttribute('href', '/app/campaigns?entity=c1');
    expect(link).toHaveTextContent(channel); expect(link).toHaveTextContent('+0.012/day');
    expect(link).toHaveTextContent('1000000000.0m'); expect(link).toHaveTextContent('89% of ceiling');
    expect(link).toHaveTextContent('~6 days');
    expect(getComputedStyle(screen.getByText(new RegExp(channel))).whiteSpace).not.toBe('nowrap');
  });
});

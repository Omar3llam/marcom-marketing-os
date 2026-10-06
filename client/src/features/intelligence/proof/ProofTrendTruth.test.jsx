// P7-06B contract ingress and reaching read: API -> actual useAccuracy/Zod ->
// ProofReading. Only transport and the unrelated outcome-write panel are mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/api/client';
import { RoleContext } from '@/context/RoleContext.jsx';
import { DecisionAccuracySchema, VelocityPeriodSchema } from '@/contracts/schemas/accuracy.schema';
import { ProofReading } from './ProofView.jsx';
import { calculateDecisionAccuracy } from '../../../../../src/services/decision-accuracy/decisionAccuracyEngine.js';
import { accuracySurface } from '../../../../../src/services/decision-accuracy/accuracyTypes.js';

vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));
vi.mock('./RecordOutcomePanel.jsx', () => ({ default: () => null }));
beforeEach(() => vi.resetAllMocks());

const cohortName = 'Calibration by decision cohort';
const measuredPeriod = { label: '2026-01', calibrationError: 0.1, sampleSize: 30, includedInTrend: true };
const window = (calibrationError) => ({
  calibrationError, accuracy: 1, sampleSize: 50, span: { from: '2025-11-01', to: '2026-01-01' },
});
function payload() {
  return {
    accountLift: { earlyWindow: window(0), recentWindow: window(0.4), calibrationImprovementPct: null, status: 'DEGRADING' },
    calibration: { bins: [{ band: '0-100%', predicted: .8, observed: 1, count: 100, gap: .2 }], binEdges: [0, 1], expectedCalibrationError: 0.2,
      populationSpan: { basis: 'DECISION_ISSUED_AT', from: '2025-11-01T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' },
      brierScore: 0.08, accuracy: 1, direction: 'UNDERCONFIDENT', sampleSize: 100 },
    velocity: { trend: 'FLAT', slope: 0, periods: [
      { label: '2025-11', calibrationError: 0.9, sampleSize: 2, includedInTrend: false },
      measuredPeriod, { label: '2026-03', calibrationError: null, sampleSize: 0, includedInTrend: false },
      { label: '2026-06', calibrationError: 0.1, sampleSize: 30, includedInTrend: true },
    ] },
    coverage: { totalDecisions: 100, scored: 100, unscorable: 0, pendingMaturation: 0, dismissed: 0,
      notAPrediction: 0, scoredFraction: 1, verdict: 'RELIABLE', note: 'Executed decisions' },
    surface: { gated: false, status: 'DEGRADING', calibrationErrorPct: 40, improvementPct: null,
      headline: "Lumi's calls on this account: calibration error 40% (was 0% in your first window) — degrading",
      scored: 100, needed: 30 },
  };
}
function renderReading() {
  return render(<MemoryRouter>
    <RoleContext.Provider value={{ role: 'STRATEGIST', loading: false, status: 'PRESENT', error: null }}>
      <ProofReading />
    </RoleContext.Provider>
  </MemoryRouter>);
}

describe('P7-06B contract parity', () => {
  it('preserves the required boolean rather than stripping server membership', () => {
    expect(VelocityPeriodSchema.parse(measuredPeriod)).toEqual(measuredPeriod);
  });
  it('admits a nullable period without discarding it or rejecting the core', () => {
    const response = payload();
    const parsed = DecisionAccuracySchema.safeParse(response);
    expect(parsed.success).toBe(true);
    expect(parsed.data.velocity.periods).toEqual(response.velocity.periods);
  });
  it('keeps measured zero valid and distinct from missing ECE', () => {
    expect(VelocityPeriodSchema.parse({ ...measuredPeriod, calibrationError: 0 }).calibrationError).toBe(0);
    expect(VelocityPeriodSchema.parse({ ...measuredPeriod, calibrationError: null,
      includedInTrend: false }).calibrationError).toBeNull();
  });
  it.each([undefined, 'true', 1, null])('refuses membership %s without defaults', (includedInTrend) => {
    expect(VelocityPeriodSchema.safeParse({ ...measuredPeriod, includedInTrend }).success).toBe(false);
  });
  it('keeps the unknown-status boundary closed', () => {
    const response = payload();
    response.velocity.trend = 'FUTURE_STATUS';
    expect(DecisionAccuracySchema.safeParse(response).success).toBe(false);
  });
  it('parses current P7-06A engine responses without widening AccountLift window fields', () => {
    for (const count of [0, 29, 30, 59, 60, 89, 90, 100, 120]) {
      const decisions = Array.from({ length: count }, (_, i) => ({
        id: String(i), accuracyStatus: 'EXECUTED', verdict: 'KILL', confidence: i < 50 ? 1 : 0.6,
        createdAt: i < 50 ? '2025-11-01' : '2026-01-01',
        outcome: { spendDeltaMinor: -100, sustained: true, windowEnd: '2026-02-01' },
      }));
      const result = calculateDecisionAccuracy({ decisions, now: new Date('2026-10-01T00:00:00Z') });
      expect(DecisionAccuracySchema.safeParse(result).success).toBe(true);
      for (const p of result.velocity.periods) expect(typeof p.includedInTrend).toBe('boolean');
      for (const win of [result.accountLift.earlyWindow, result.accountLift.recentWindow]) {
        if (win) {
          expect(Number.isFinite(win.calibrationError)).toBe(true);
          expect(Number.isFinite(win.accuracy)).toBe(true);
        }
      }
    }
  });
});

describe('P7-06B reaching Proof read', () => {
  it('transports membership and nullable evidence to text while preserving the zero-baseline server headline', async () => {
    const response = payload();
    api.get.mockResolvedValue({ data: response });
    renderReading();
    const section = await screen.findByRole('region', { name: cohortName });
    expect(api.get).toHaveBeenCalledWith('/api/lumi/accuracy');
    expect(screen.getByText(response.surface.headline)).toBeInTheDocument();
    expect(within(section).getByText('Steady')).toBeInTheDocument();
    expect(within(section).getAllByRole('listitem')).toHaveLength(4);
    const missing = within(section).getByText('2026-03').closest('li');
    expect(missing).toHaveTextContent('Calibration error: —');
    expect(missing).toHaveTextContent('n=0');
    expect(missing).toHaveTextContent('Not used in trend');
    expect(missing).not.toHaveTextContent('0%');
    expect(within(section).getByText('2025-11').closest('li')).toHaveTextContent('90%');
    expect(within(section).getAllByText('Used in trend')).toHaveLength(2);
    expect(within(section).getAllByText('Not used in trend')).toHaveLength(2);
    expect(section.querySelector('polyline')).toBeNull();
    expect(screen.queryByText(/holding steady|Infinity/)).not.toBeInTheDocument();
    expect(screen.queryByText('-100%')).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn't load Proof/i)).not.toBeInTheDocument();
  });
  it('renders legitimate improving AccountLift and steady cohorts as separate backend facts', async () => {
    const response = payload();
    response.accountLift = { earlyWindow: window(0.2), recentWindow: window(0.1),
      calibrationImprovementPct: 0.5, status: 'IMPROVING' };
    response.surface = { ...response.surface, status: 'IMPROVING', improvementPct: 50,
      headline: "Lumi's calls: calibration error 10% (was 20%) — improving" };
    api.get.mockResolvedValue({ data: response });
    renderReading();
    const section = await screen.findByRole('region', { name: cohortName });
    expect(screen.getByText(response.surface.headline)).toBeInTheDocument();
    expect(section).toHaveTextContent('Cohort trend: Steady');
    expect(section).not.toHaveTextContent(/overall|contradiction/i);
  });
  it('renders a real P7-06A zero-baseline response without calculating a percentage on the client', async () => {
    const decisions = Array.from({ length: 100 }, (_, i) => ({
      id: String(i), accuracyStatus: 'EXECUTED', verdict: 'KILL', confidence: i < 50 ? 1 : 0.6,
      createdAt: i < 50 ? '2025-11-01' : '2026-01-01',
      outcome: { spendDeltaMinor: -100, sustained: true, windowEnd: '2026-02-01' },
    }));
    const data = calculateDecisionAccuracy({ decisions, now: new Date('2026-10-01T00:00:00Z') });
    const surface = accuracySurface(data);
    expect(data.accountLift.status).toBe('DEGRADING');
    expect(surface.improvementPct).toBeNull();
    api.get.mockResolvedValue({ data: { ...data, surface } });
    renderReading();
    await screen.findByRole('region', { name: cohortName });
    expect(screen.getByText(surface.headline)).toBeInTheDocument();
    expect(screen.queryByText(/holding steady|Infinity/)).not.toBeInTheDocument();
    expect(screen.queryByText('-100%')).not.toBeInTheDocument();
  });
  it.each(['missing membership', 'unknown trend'])('keeps %s as failed read instead of healthy history', async (defect) => {
    const response = payload();
    if (defect === 'missing membership') delete response.velocity.periods[0].includedInTrend;
    else response.velocity.trend = 'FUTURE_STATUS';
    api.get.mockResolvedValue({ data: response });
    renderReading();
    expect(await screen.findByText(/couldn't load Proof of Learning/i)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: cohortName })).not.toBeInTheDocument();
    expect(screen.queryByText(response.surface.headline)).not.toBeInTheDocument();
    // Known unsupported recovery CTA is deliberately unchanged in this slice.
    expect(screen.getByRole('link', { name: 'Connect Meta →' })).toBeInTheDocument();
  });
  it('preserves a transport failure without presenting still-learning or empty calibration', async () => {
    api.get.mockRejectedValue(new Error('Unavailable'));
    renderReading();
    await waitFor(() => expect(screen.getByText(/couldn't load Proof of Learning/i)).toBeInTheDocument());
    expect(screen.queryByText('Still learning')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: cohortName })).not.toBeInTheDocument();
  });
});

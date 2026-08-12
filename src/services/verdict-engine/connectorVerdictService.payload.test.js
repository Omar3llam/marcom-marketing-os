// ============================================================
// getConnectorVerdicts — the verdict payload carries revenueExpected
// ------------------------------------------------------------
// The objective-aware RATIONALE (per row) is covered by connectorVerdict.test.js.
// This pins the API contract the frontend banner depends on: each verdict in the
// payload carries `revenueExpected` (server-derived from the Meta objective), so
// the aggregate banner can split awareness (by design) from a conversion campaign
// with a tracking gap — without the FE re-deriving objective classification.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCanonicalVerdictCampaigns } = vi.hoisted(() => ({ getCanonicalVerdictCampaigns: vi.fn() }));

vi.mock('../entity-graph/index.js', () => ({ getCanonicalVerdictCampaigns }));
// Phase D.4: the verdict path reads CANONICAL evidence and is handed an
// envelope — the campaigns that have a canonical row, plus the identities that
// have none. These tests are about the campaigns, so noCanonicalWindow is empty;
// the absence path has its own tests in canonicalVerdictEvidence.test.js.
const mockCampaigns = (rows) => getCanonicalVerdictCampaigns.mockResolvedValue({ campaigns: rows, noCanonicalWindow: [] });
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getConnectorVerdicts } from './connectorVerdictService.js';

// An engaged, no-revenue connector row (spend + impressions, revenue 0) — the
// engine's awareness track. Objective decides awareness vs tracking-gap framing.
const engaged = (over = {}) => ({
  entityId: 'c1', name: 'Campaign', channel: 'META',
  spendMinor: 10000, revenueMinor: 0, impressions: 1000, clicks: 20,
  conversions: 0, frequency: 2.0, currency: 'USD', ...over,
});

describe('getConnectorVerdicts payload — revenueExpected', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a conversion objective (OUTCOME_LEADS) with no revenue → revenueExpected true', async () => {
    mockCampaigns([engaged({ objective: 'OUTCOME_LEADS' })]);
    const { verdicts } = await getConnectorVerdicts('ws-1');
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].revenueExpected).toBe(true);
    expect(verdicts[0].roas).toBeNull(); // still no fabricated revenue
  });

  it('an awareness objective (OUTCOME_AWARENESS) → revenueExpected false', async () => {
    mockCampaigns([engaged({ objective: 'OUTCOME_AWARENESS' })]);
    const { verdicts } = await getConnectorVerdicts('ws-1');
    expect(verdicts[0].revenueExpected).toBe(false);
  });

  it('a null/unknown objective → revenueExpected false (never fabricate a tracking-gap claim)', async () => {
    mockCampaigns([engaged({ objective: null })]);
    const { verdicts } = await getConnectorVerdicts('ws-1');
    expect(verdicts[0].revenueExpected).toBe(false);
  });

  it('every payload verdict carries the field (never undefined)', async () => {
    mockCampaigns([
      engaged({ entityId: 'a', objective: 'OUTCOME_SALES' }),
      engaged({ entityId: 'b', objective: 'OUTCOME_TRAFFIC' }),
    ]);
    const { verdicts } = await getConnectorVerdicts('ws-1');
    expect(verdicts.every((v) => typeof v.revenueExpected === 'boolean')).toBe(true);
  });
});

describe('getConnectorVerdicts payload — signalType + recommendationTypes (decision-first)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('forwards the deterministic diagnosis signalType (a real SIGNAL_TYPE, not undefined)', async () => {
    mockCampaigns([engaged({ objective: 'OUTCOME_AWARENESS' })]);
    const { verdicts } = await getConnectorVerdicts('ws-1');
    expect(verdicts).toHaveLength(1);
    // signalType is always computed by judgeMetrics → diagnoseSignals (never dropped).
    expect(typeof verdicts[0].signalType).toBe('string');
    expect(verdicts[0].signalType.length).toBeGreaterThan(0);
  });

  it('forwards recommendationTypes as an array on every verdict', async () => {
    mockCampaigns([
      engaged({ entityId: 'a', objective: 'OUTCOME_SALES' }),
      engaged({ entityId: 'b', objective: 'OUTCOME_AWARENESS' }),
    ]);
    const { verdicts } = await getConnectorVerdicts('ws-1');
    expect(verdicts.every((v) => Array.isArray(v.recommendationTypes))).toBe(true);
  });
});

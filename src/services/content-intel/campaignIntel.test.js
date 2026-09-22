// ============================================================
// campaignIntel — top-campaign selection + prompt-block formatting
// ------------------------------------------------------------
// Pure selection/formatting is unit-tested directly; getCampaignIntelligence
// mocks only the two connector read-services it composes.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../entity-graph/index.js', () => ({ getConnectorCampaigns: vi.fn() }));
vi.mock('../verdict-engine/connectorVerdictService.js', () => ({ getConnectorVerdicts: vi.fn() }));

import { getConnectorCampaigns } from '../entity-graph/index.js';
import { getConnectorVerdicts }  from '../verdict-engine/connectorVerdictService.js';
import { selectTopCampaigns, formatCampaignIntel, getCampaignIntelligence } from './campaignIntel.js';

const camp = (over = {}) => ({
  entityId: 'c1', name: 'Eid Sale', channel: 'META',
  spendMinor: 50000, ctr: 0.03, frequency: 1.4, roas: 2.1, currency: 'EGP', ...over,
});
const verdict = (over = {}) => ({ id: 'c1', name: 'Eid Sale', verdict: 'SCALE', rationale: 'Strong ROAS — scale.', ...over });

describe('selectTopCampaigns (pure)', () => {
  it('joins verdicts (by id) to campaigns (by entityId), skips zero-spend, tops by spend', () => {
    const campaigns = [
      camp({ entityId: 'a', name: 'A', spendMinor: 100 }),
      camp({ entityId: 'b', name: 'B', spendMinor: 900 }),
      camp({ entityId: 'z', name: 'Zero', spendMinor: 0 }),   // roster row → dropped
    ];
    const verdicts = [verdict({ id: 'b', verdict: 'KILL', rationale: 'Bleeding.' })];
    const top = selectTopCampaigns(campaigns, verdicts);
    expect(top.map((c) => c.name)).toEqual(['B', 'A']);       // spend desc, zero-spend gone
    expect(top[0]).toMatchObject({ verdict: 'KILL', rationale: 'Bleeding.' });
    expect(top[1].verdict).toBeNull();                        // no verdict for A
  });

  it('caps at 5 campaigns', () => {
    const campaigns = Array.from({ length: 8 }, (_, i) => camp({ entityId: `e${i}`, spendMinor: (i + 1) * 100 }));
    expect(selectTopCampaigns(campaigns, [])).toHaveLength(5);
  });

  it('preserves null metrics (awareness campaign) — never zero-fills', () => {
    const top = selectTopCampaigns([camp({ ctr: null, roas: null })], [verdict()]);
    expect(top[0].ctr).toBeNull();
    expect(top[0].roas).toBeNull();
  });

  it.each(['EGP', 'USD', 'SAR'])('preserves spend ranking for homogeneous %s', (currency) => {
    const top = selectTopCampaigns([
      camp({ entityId: 'small', name: 'Small', spendMinor: 100, currency }),
      camp({ entityId: 'big', name: 'Big', spendMinor: 900, currency }),
    ]);
    expect(top.map((c) => c.name)).toEqual(['Big', 'Small']);
  });

  it.each([
    ['EGP + USD', 'EGP', 'USD'],
    ['SAR + EGP', 'SAR', 'EGP'],
    ['known + null', 'EGP', null],
    ['known + malformed', 'USD', 'XYZ'],
  ])('%s yields no spend-ranked slice', (_label, first, second) => {
    const top = selectTopCampaigns([
      camp({ entityId: 'a', currency: first, spendMinor: 100 }),
      camp({ entityId: 'b', currency: second, spendMinor: 900 }),
    ]);
    expect(top).toEqual([]);
  });
});

describe('formatCampaignIntel (pure)', () => {
  it('renders verdict + rationale + only the present metrics', () => {
    const block = formatCampaignIntel(selectTopCampaigns([camp()], [verdict()]));
    expect(block).toContain('CURRENT CAMPAIGN PERFORMANCE');
    expect(block).toContain('- Eid Sale (META): SCALE — Strong ROAS — scale.');
    expect(block).toContain('CTR 3.00%');      // 0.03 fraction → percent
    expect(block).toContain('Freq 1.4');
    expect(block).toContain('ROAS 2.10');
    expect(block).toContain('KILL campaigns: suggest completely new messaging');
    expect(block).toContain('High frequency (>3.5): suggest a new audience angle');
  });

  it('omits null metrics from the metrics parenthetical (no fabrication)', () => {
    const block = formatCampaignIntel(selectTopCampaigns([camp({ ctr: null, roas: null })], [verdict({ rationale: 'Awareness — hold.' })]));
    // Only the present metric survives in the group — no fabricated CTR/ROAS.
    expect(block).toContain('(Freq 1.4)');
    expect(block).not.toMatch(/CTR \d/);   // no "CTR 3.00%" metric emitted
    expect(block).not.toMatch(/ROAS \d/);  // no "ROAS 2.10" metric emitted
  });

  it('returns an empty string when there is nothing to say', () => {
    expect(formatCampaignIntel([])).toBe('');
  });
});

describe('getCampaignIntelligence (composition)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('composes the block from the connector substrate', async () => {
    getConnectorCampaigns.mockResolvedValue([camp()]);
    getConnectorVerdicts.mockResolvedValue({ verdicts: [verdict()] });
    const block = await getCampaignIntelligence('ws1');
    expect(block).toContain('- Eid Sale (META): SCALE');
  });

  it('returns "" when no connector has synced (graceful omit)', async () => {
    getConnectorCampaigns.mockResolvedValue([]);
    getConnectorVerdicts.mockResolvedValue({ verdicts: [] });
    expect(await getCampaignIntelligence('ws1')).toBe('');
  });

  it('omits Content Lab intelligence when campaign currencies are mixed', async () => {
    getConnectorCampaigns.mockResolvedValue([
      camp({ entityId: 'egp', currency: 'EGP', spendMinor: 100 }),
      camp({ entityId: 'usd', currency: 'USD', spendMinor: 900 }),
    ]);
    getConnectorVerdicts.mockResolvedValue({ verdicts: [] });
    expect(await getCampaignIntelligence('ws1')).toBe('');
  });

  it('never throws — a read failure yields "" so generation continues', async () => {
    getConnectorCampaigns.mockRejectedValue(new Error('db down'));
    getConnectorVerdicts.mockResolvedValue({ verdicts: [] });
    expect(await getCampaignIntelligence('ws1')).toBe('');
  });

  it('returns "" without a workspaceId', async () => {
    expect(await getCampaignIntelligence(null)).toBe('');
    expect(getConnectorCampaigns).not.toHaveBeenCalled();
  });
});

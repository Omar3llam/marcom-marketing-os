import { describe, it, expect } from 'vitest';
import { CAMPAIGN_INSIGHT_FIELDS } from './metaAdsService.js';
import { metaNormalize } from './connectors/normalize/metaNormalize.js';
import { toSnapshotRows } from './connectors/snapshotSink.js';

// Guards the revenue-honesty wiring: Meta must REQUEST action_values, or revenue
// lands 0 and every connector campaign reads "—" for ROAS. This is the exact
// regression we are fixing — pin it so it can't silently regress.
describe('CAMPAIGN_INSIGHT_FIELDS — revenue is actually requested', () => {
  it('requests action_values (the claimed revenue signal) alongside actions', () => {
    expect(CAMPAIGN_INSIGHT_FIELDS).toContain('action_values');
    expect(CAMPAIGN_INSIGHT_FIELDS).toContain('actions');
    expect(CAMPAIGN_INSIGHT_FIELDS).toContain('campaign_id'); // entity id the normalizer keys on
  });

  it('full chain: requested action_values → real revenue → real ROAS (not null)', () => {
    // A row shaped as Meta returns it once action_values is in the field list.
    const normalized = metaNormalize({
      accountExternalId: 'act_1', currency: 'USD', date: new Date('2026-06-01T00:00:00.000Z'),
      rows: [{
        campaign_id: 'c1', campaign_name: 'Eid', spend: '100.00', impressions: '1000', clicks: '50',
        actions: [{ action_type: 'purchase', value: '8' }],
        action_values: [{ action_type: 'purchase', value: '400.00' }],
      }],
    });
    const campaign = toSnapshotRows('ws1', 'META', normalized).find((r) => r.entityLevel === 'CAMPAIGN');
    expect(campaign.revenueMinor).toBe(40000);
    expect(campaign.roas).toBe(4); // 40000 / 10000 — a real derived number, not null
  });
});

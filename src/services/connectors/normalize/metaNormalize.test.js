// ============================================================
// metaNormalize — identifier-less rows are dropped, not collided
// ------------------------------------------------------------
// The old `externalId: String(id ?? name ?? 'unknown')` fallback made every row
// lacking BOTH a campaign_id and a campaign_name collide onto one 'unknown'
// entity id (detId), silently merging distinct campaigns. Now such rows are
// dropped (malformed Meta data). Pins that, plus the name-only path.
// ============================================================
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { metaNormalize } from './metaNormalize.js';
import { logger } from '../../../utils/logger.js';

const base = { accountExternalId: 'act_1', currency: 'USD', date: new Date('2026-07-01T00:00:00Z') };
const campaignsOf = (out) => out.filter((r) => r.entityLevel === 'CAMPAIGN');

describe('metaNormalize — no "unknown" externalId collision', () => {
  it('drops a row with neither campaign_id nor campaign_name (and warns)', () => {
    const out = metaNormalize({
      ...base,
      rows: [
        { campaign_id: 'c1', campaign_name: 'Real', spend: '100' },
        { spend: '50' }, // no identifier → dropped
      ],
    });
    const campaigns = campaignsOf(out);
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].externalId).toBe('c1');
    expect(out.some((r) => r.externalId === 'unknown')).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('two identifier-less rows no longer collide — both are dropped (was one merged "unknown")', () => {
    const out = metaNormalize({ ...base, rows: [{ spend: '10' }, { spend: '20' }] });
    expect(campaignsOf(out)).toHaveLength(0);
  });

  it('a name-only row keeps its name as the externalId (never "unknown")', () => {
    const out = metaNormalize({ ...base, rows: [{ campaign_name: 'NamedOnly', spend: '10' }] });
    const c = campaignsOf(out)[0];
    expect(c.externalId).toBe('NamedOnly');
  });
});

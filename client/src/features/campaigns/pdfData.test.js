// ============================================================
// pdfData — connector graph → PDF rows (honest, currency-correct, no dup)
// ------------------------------------------------------------
// Pins the substrate repoint: rows come from the LIVE connector campaigns,
// spend uses the currency's real minor-unit exponent (never /100), CTR is
// converted fraction→percentage, gated campaigns are marked honestly, and every
// campaign appears exactly once (no double-count from the gatedOut list).
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildPdfCampaigns } from './pdfData.js';

describe('buildPdfCampaigns', () => {
  it('converts spend via fromMinor (currency exponent, not /100) and CTR ×100', () => {
    const rows = buildPdfCampaigns({
      connectorCampaigns: [
        { entityId: 'e1', name: 'A', spendMinor: 123456, ctr: 0.0185, roas: 2.5, currency: 'EGP' }, // 2-digit
        { entityId: 'e2', name: 'B', spendMinor: 1000000, ctr: 0.02, roas: null, currency: 'KWD' }, // 3-digit
      ],
      verdictByEntityId: { e1: 'KILL' },
      verdictInfoByEntityId: { e1: { rationale: 'Lowest CTR in group' } },
    });
    expect(rows[0].spend).toBeCloseTo(1234.56); // EGP: /100
    expect(rows[0].ctr).toBeCloseTo(1.85);      // fraction → percentage
    expect(rows[0].verdict).toBe('KILL');
    expect(rows[0].rationale).toBe('Lowest CTR in group');
    expect(rows[1].spend).toBeCloseTo(1000);    // KWD: /1000, NOT /100
  });

  it('marks gated campaigns honestly and lists each campaign exactly once', () => {
    const rows = buildPdfCampaigns({
      connectorCampaigns: [
        { entityId: 'e1', name: 'Scored', spendMinor: 5000, ctr: 0.01, roas: 3, currency: 'USD' },
        { entityId: 'e2', name: 'Gated',  spendMinor: 2000, ctr: 0.01, roas: null, currency: 'USD' },
      ],
      verdictByEntityId: { e1: 'SCALE' },
      verdictInfoByEntityId: { e1: { rationale: 'Top CTR' } },
      gatedOutIds: new Set(['e2']),
    });
    expect(rows).toHaveLength(2); // no duplication of the gated row
    const gated = rows.find((r) => r.entityId === 'e2');
    expect(gated.verdict).toBeNull();
    expect(gated.needsRevenue).toBe(true);
    expect(gated.rationale).toBe('Add revenue data to unlock verdict');
    expect(gated.spend).toBeCloseTo(20); // REAL spend from the connector row, not 0
  });

  it('null spendMinor / ctr stay null (honest "—", never a fabricated 0)', () => {
    const rows = buildPdfCampaigns({
      connectorCampaigns: [{ entityId: 'e1', name: 'A', spendMinor: null, ctr: null, roas: null, currency: 'USD' }],
    });
    expect(rows[0].spend).toBeNull();
    expect(rows[0].ctr).toBeNull();
    expect(rows[0].verdict).toBeNull();
  });
});

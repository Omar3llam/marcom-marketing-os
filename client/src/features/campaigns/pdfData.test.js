// ============================================================
// pdfData — connector graph → PDF rows (honest, currency-correct, no dup)
// ------------------------------------------------------------
// Pins the substrate repoint: rows come from the LIVE connector campaigns,
// spend uses the currency's real minor-unit exponent (never /100), CTR is
// converted fraction→percentage, gated campaigns are marked honestly, and every
// campaign appears exactly once (no double-count from the gatedOut list).
// ============================================================
import { describe, it, expect } from 'vitest';
import { GATING_REASON } from '@marcom/runtime-contracts';
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
      gatedOut: [{ id: 'e2', name: 'Gated', reason: GATING_REASON.NO_MEASURABLE_DELIVERY }],
    });
    expect(rows).toHaveLength(2); // no duplication of the gated row
    const gated = rows.find((r) => r.entityId === 'e2');
    expect(gated.verdict).toBeNull();
    expect(gated.gatingReason).toBe(GATING_REASON.NO_MEASURABLE_DELIVERY);
    expect(gated.rationale).toMatch(/revenue/i);
    expect(gated.spend).toBeCloseTo(20); // REAL spend from the connector row, not 0
  });

  // -- C-07 - test 8: the reason survives the door ---------------------------
  it('gives three gated campaigns three different rationales, from their reasons', () => {
    // THE DEFECT, AS A TEST. This function used to take a Set of ids, so all
    // three of these got the single line "Add revenue data to unlock verdict" -
    // an instruction that is wrong for two of them.
    const rows = buildPdfCampaigns({
      connectorCampaigns: [
        { entityId: 'd', name: 'Dataless', spendMinor: 0,    currency: 'USD' },
        { entityId: 'n', name: 'Never',    spendMinor: 1000, currency: 'USD' },
        { entityId: 's', name: 'Stale',    spendMinor: 2000, currency: 'USD' },
      ],
      gatedOut: [
        { id: 'd', reason: GATING_REASON.NO_MEASURABLE_DELIVERY },
        { id: 'n', reason: GATING_REASON.NO_CANONICAL_WINDOW },
        { id: 's', reason: GATING_REASON.CANONICAL_EVIDENCE_STALE, measurementAgeDays: 42, maxAgeDays: 3 },
      ],
    });
    const rationales = rows.map((r) => r.rationale);
    expect(new Set(rationales).size).toBe(3);
    // Only ONE of the three is about revenue.
    expect(rationales.filter((r) => /revenue/i.test(r))).toHaveLength(1);
    // And the stale row states the age the backend measured, not a generic note.
    expect(rows.find((r) => r.entityId === 's').rationale).toMatch(/42/);
  });

  it('carries no needsRevenue field - it named one reason and was set for three', () => {
    const rows = buildPdfCampaigns({
      connectorCampaigns: [{ entityId: 's', name: 'Stale', spendMinor: 1, currency: 'USD' }],
      gatedOut: [{ id: 's', reason: GATING_REASON.CANONICAL_EVIDENCE_STALE, measurementAgeDays: 9, maxAgeDays: 3 }],
    });
    expect(rows[0]).not.toHaveProperty('needsRevenue');
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

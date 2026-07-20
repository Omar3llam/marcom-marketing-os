// ============================================================
// CampaignsView — PDF export gate reads the connector substrate
// ------------------------------------------------------------
// The audit's core defect: the PDF button gated on the retired CSV feed
// (allRows), so it was permanently disabled on every connector-only account.
// `canExportPdf` gates on the LIVE connector campaigns instead. Pins the
// predicate without booting the page (which needs the feed context + hooks).
// ============================================================
import { describe, it, expect } from 'vitest';
import { canExportPdf } from './CampaignsView.jsx';

describe('canExportPdf — export gate follows connector data', () => {
  it('is disabled when there are no connector campaigns', () => {
    expect(canExportPdf([])).toBe(false);
    expect(canExportPdf()).toBe(false); // defensive default
  });

  it('is enabled the moment a connector campaign exists', () => {
    expect(canExportPdf([{ entityId: 'e1' }])).toBe(true);
  });
});

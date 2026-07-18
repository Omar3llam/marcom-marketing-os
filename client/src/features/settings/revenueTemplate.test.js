// ============================================================
// revenueTemplate — the pre-filled revenue CSV (pure, client-side)
// ------------------------------------------------------------
// The template must carry the user's REAL campaign names (needs-revenue only,
// biggest spenders first) with the revenue column left blank — and degrade to
// the generic placeholder file when nothing is loaded. All string-building,
// no network: the functions take the already-fetched campaign list as input.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import {
  TEMPLATE_HEADER, templateCampaignsFor, escapeCsvField, buildTemplateCsv, downloadTemplate,
} from './revenueTemplate.js';

const c = (over = {}) => ({ entityId: 'x', name: 'Campaign', needsRevenue: true, spendMinor: 1000, ...over });

describe('templateCampaignsFor', () => {
  it('keeps only needs-revenue campaigns, highest spend first', () => {
    const out = templateCampaignsFor([
      c({ name: 'Small', spendMinor: 100 }),
      c({ name: 'Has revenue', needsRevenue: false, spendMinor: 99999 }),
      c({ name: 'Big', spendMinor: 900000 }),
    ]);
    expect(out.map((x) => x.name)).toEqual(['Big', 'Small']);
  });

  it('a campaign with unknown spend sinks last (missing ≠ small)', () => {
    const out = templateCampaignsFor([
      c({ name: 'No spend', spendMinor: null }),
      c({ name: 'Spender', spendMinor: 1 }),
    ]);
    expect(out.map((x) => x.name)).toEqual(['Spender', 'No spend']);
  });

  it('drops rows with no usable name (nothing to match an upload against)', () => {
    const out = templateCampaignsFor([c({ name: '   ' }), c({ name: undefined }), c({ name: 'Real' })]);
    expect(out.map((x) => x.name)).toEqual(['Real']);
  });

  it('empty/absent input → empty list', () => {
    expect(templateCampaignsFor()).toEqual([]);
    expect(templateCampaignsFor([])).toEqual([]);
  });
});

describe('escapeCsvField', () => {
  it('quotes fields containing commas and doubles embedded quotes', () => {
    expect(escapeCsvField('Porto Golf - Leads')).toBe('Porto Golf - Leads');
    expect(escapeCsvField('Leads, Cairo')).toBe('"Leads, Cairo"');
    expect(escapeCsvField('The "Best" Ads')).toBe('"The ""Best"" Ads"');
  });
});

describe('buildTemplateCsv', () => {
  it('pre-fills real campaign names with revenue + conversions left blank', () => {
    const csv = buildTemplateCsv([c({ name: 'Porto Golf - Leads' }), c({ name: 'QSource Academy' })]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe(TEMPLATE_HEADER.join(','));
    expect(lines[1]).toBe('Porto Golf - Leads,,');
    expect(lines[2]).toBe('QSource Academy,,');
  });

  it('a name containing a comma stays one CSV field', () => {
    const csv = buildTemplateCsv([c({ name: 'Leads, Cairo' })]);
    expect(csv.split('\n')[1]).toBe('"Leads, Cairo",,');
  });

  it('no campaigns → the generic placeholder template (blank, never fake-real)', () => {
    const csv = buildTemplateCsv([]);
    expect(csv).toContain('Your Campaign Name Here');
    expect(csv.split('\n')[0]).toBe(TEMPLATE_HEADER.join(','));
  });
});

describe('downloadTemplate', () => {
  it('builds a text/csv blob carrying the campaign names and triggers a named download', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.fn();
    const created = { set href(v) { this._href = v; }, get href() { return this._href; }, click };
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(created);

    downloadTemplate([c({ name: 'Porto Golf - Leads' })]);

    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe('text/csv');
    expect(await blob.text()).toContain('Porto Golf - Leads,,');
    expect(created.download).toBe('lumi-revenue-template.csv');
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');

    createElement.mockRestore();
    vi.unstubAllGlobals();
  });
});

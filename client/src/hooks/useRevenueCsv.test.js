// ============================================================
// useRevenueCsv.parseCsvFile — header parsing + preview
// ------------------------------------------------------------
// papaparse accepts a CSV string as well as a File; we feed a string so the test
// stays hermetic. Pins the columns, the row set, and the 3-row preview the
// mapping UI renders.
// ============================================================
import { describe, it, expect } from 'vitest';
import { parseCsvFile } from './useRevenueCsv.js';

describe('parseCsvFile', () => {
  it('returns columns, all rows, and a 3-row preview', async () => {
    const csv = 'Campaign,Revenue\nFolla Facebook,12500\nLead Alex,8300\nSales,0\nExtra,100';
    const { columns, rows, preview } = await parseCsvFile(csv);

    expect(columns).toEqual(['Campaign', 'Revenue']);
    expect(rows).toHaveLength(4);
    expect(preview).toHaveLength(3);
    expect(preview[0]).toMatchObject({ Campaign: 'Folla Facebook', Revenue: '12500' });
  });

  it('skips blank lines and keeps header field names verbatim', async () => {
    const csv = 'Campaign Name,Total Revenue\n\nEid Sale,4200\n';
    const { columns, rows } = await parseCsvFile(csv);
    expect(columns).toEqual(['Campaign Name', 'Total Revenue']);
    expect(rows).toHaveLength(1);
    expect(rows[0]['Campaign Name']).toBe('Eid Sale');
  });
});

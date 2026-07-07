// ============================================================
// useRevenueCsv — parse a revenue CSV (client-side) + upload mapped rows
// ------------------------------------------------------------
// The browser parses + maps columns (papaparse), then POSTs STRUCTURED rows to
// POST /api/lumi/revenue/csv — the backend never handles a raw file. The backend
// fuzzy-matches campaign names and lands the revenue as MANUAL actuals.
// ============================================================
import { useState, useCallback } from 'react';
import Papa from 'papaparse';
import { api } from '@/lib/api.js';

/**
 * Parse a File (or CSV string) with a header row.
 * @returns {Promise<{ columns: string[], rows: object[], preview: object[] }>}
 */
export function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = (results.data ?? []).filter((r) => r && Object.keys(r).length > 0);
        resolve({
          columns: results.meta?.fields ?? [],
          rows,
          preview: rows.slice(0, 3),
        });
      },
      error: reject,
    });
  });
}

export function useRevenueCsv() {
  const [isUploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const parse = useCallback((file) => parseCsvFile(file), []);

  const upload = useCallback(async (rows) => {
    setUploading(true);
    setError(null);
    try {
      const res = await api.post('/api/lumi/revenue/csv', { rows });
      setResult(res.data);
      return res.data;
    } catch (err) {
      const msg = err?.response?.data?.message || err?.response?.data?.error || 'Upload failed. Try again.';
      setError(msg);
      throw err;
    } finally {
      setUploading(false);
    }
  }, []);

  const reset = useCallback(() => { setResult(null); setError(null); }, []);

  return { parse, upload, isUploading, result, error, reset };
}

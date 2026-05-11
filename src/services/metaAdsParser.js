// ============================================================
// MARCOM / Lumi — Meta Ads Manager CSV Parser
// ============================================================
// Meta exports at AD SET level — each row is one ad set.
// Multiple rows can belong to the same campaign.
//
// Known issues handled:
//   - BOM character (0xFEFF) at file start
//   - Row 2 is a SUMMARY/TOTAL row (empty Campaign name) — skipped
//   - No Campaign ID column — composite ID from campaign + adset name
//   - Multi-currency support (EGP, USD, SAR, AED, GBP, EUR)
//   - No ROAS column — estimated from CTR + frequency
//   - "Results" = conversion count (not clicks)
//
// V2 HARDENING:
//   - Centralized column alias registry (handles 40+ variants)
//   - Robust monetary value parsing (US + EU formats)
//   - Validation warnings for unmapped headers
//   - Early detection of spend=0 data loss
// ============================================================
import { parse } from 'csv-parse/sync';
import { resolveHeader, cleanMonetaryValue, COLUMN_ALIASES } from '../lib/csvColumnAliases.js';

/**
 * Parse a Meta Ads Manager CSV export buffer.
 *
 * @param {Buffer} fileBuffer - raw file buffer from multer memoryStorage
 * @returns {{ campaigns: Array, errors: Array|null, stats: object }}
 */
export function parseMetaAdsCsv(fileBuffer) {
  try {
    // ── 1. Strip BOM ──────────────────────────────────────────
    let text = fileBuffer.toString('utf8');
    if (text.charCodeAt(0) === 0xFEFF) {
      text = text.slice(1);
    }

    // ── 2. Parse CSV ──────────────────────────────────────────
    const records = parse(text, {
      columns:             true,
      skip_empty_lines:    true,
      relax_column_count:  true,
      trim:                true,
    });

    if (!records || records.length === 0) {
      return {
        campaigns: [],
        errors:    ['CSV is empty or could not be parsed'],
        stats:     { total_rows: 0, skipped: 0, valid: 0 },
      };
    }

    // ── 3. Build header→field mapping ONCE ───────────────────
    const rawHeaders = Object.keys(records[0]);
    const headerMap = {};

    console.log('[metaAdsParser] Raw CSV headers:', rawHeaders);

    for (const rawHeader of rawHeaders) {
      const field = resolveHeader(rawHeader, COLUMN_ALIASES);
      if (field) {
        headerMap[rawHeader] = field;
      }
    }

    // Warn about unmapped headers (catch regressions)
    const unmappedHeaders = rawHeaders.filter((h) => !headerMap[h]);
    if (unmappedHeaders.length > 0) {
      console.warn(
        '[metaAdsParser] Unmapped headers (not used in parsing):',
        unmappedHeaders,
      );
    }

    console.log('[metaAdsParser] Header mapping:', headerMap);

    const campaigns = [];
    const errors    = [];
    let   skipped   = 0;

    records.forEach((record, idx) => {
      // ── 4. Skip summary/total rows (empty Campaign name) ─────
      const campaignName = record['Campaign name']
        ? String(record['Campaign name']).trim()
        : '';

      if (!campaignName) {
        skipped++;
        return;
      }

      const campaign = buildCampaign(record, headerMap);

      if (campaign) {
        campaigns.push(campaign);

        // ✅ Debug: Log first parsed campaign to verify header mapping
        if (campaigns.length === 1) {
          console.log('[metaAdsParser] First parsed campaign:', {
            campaignId: campaign.campaignId,
            campaignName: campaign.campaignName,
            spend: campaign.spend,
            impressions: campaign.impressions,
            results: campaign.results,
            ctr: campaign.ctr,
            roas: campaign.roas,
          });
        }
      } else {
        errors.push(`Row ${idx + 2}: could not parse — skipped`);
      }
    });

    // ── 5. Validate: detect silent data loss ─────────────────
    const totalSpend = campaigns.reduce((sum, c) => sum + (c.spend || 0), 0);

    if (totalSpend === 0 && campaigns.length > 0) {
      console.error(
        '[metaAdsParser] CRITICAL: Parsed',
        campaigns.length,
        'campaigns but total spend is $0.00',
        '\n  → Raw headers:', rawHeaders,
        '\n  → Mapped fields:', Object.values(headerMap),
        '\n  → This indicates column mapping failure!',
      );
      errors.push(
        'Warning: All campaigns have $0 spend. This may indicate a CSV format mismatch.',
      );
    }

    console.log(
      '[metaAdsParser] Parse complete:',
      campaigns.length,
      'campaigns, total spend:',
      `$${totalSpend.toFixed(2)}`,
    );

    return {
      campaigns,
      errors: errors.length > 0 ? errors : null,
      stats: {
        total_rows: records.length,
        skipped,
        valid:      campaigns.length,
      },
    };

  } catch (err) {
    return {
      campaigns: [],
      errors:    [`Parse error: ${err.message}`],
      stats:     { total_rows: 0, skipped: 0, valid: 0 },
    };
  }
}

// ── Internals ────────────────────────────────────────────────

/**
 * Build a campaign object from a CSV record using the header map.
 * Uses robust monetary parsing and falls back gracefully for missing fields.
 *
 * @param {object} record - Single CSV row as key-value pairs
 * @param {object} headerMap - Mapping of raw headers to standardized field names
 * @returns {object|null} - Campaign object, or null if invalid
 */
function buildCampaign(record, headerMap) {
  try {
    // ── Extract campaign identifiers ──────────────────────────
    const campaignName = getFieldValue(record, headerMap, 'campaignName')
      || String(record['Campaign name'] || '').trim();

    const adsetName = getFieldValue(record, headerMap, 'adsetName')
      || String(record['Ad set name'] || '').trim();

    if (!campaignName) return null;

    // ── Stable composite ID (no Campaign ID in Meta export) ──
    // Slug is deterministic so re-uploads of the same data don't
    // create duplicate CampaignState rows (Prisma upsert on campaignId).
    const slug = `${campaignName}__${adsetName}`
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 100);

    const campaignId = `meta__${slug}`;

    // ── Parse numeric fields using robust monetary parser ─────
    const spend = cleanMonetaryValue(
      getFieldValue(record, headerMap, 'spend')
      || pickColumn(record, 'Amount spent (EGP)', 'Amount spent', 'Spend', 'Cost'),
    );

    const impressions = parseNum(
      getFieldValue(record, headerMap, 'impressions')
      || record['Impressions'],
    );

    const results = parseNum(
      getFieldValue(record, headerMap, 'results')
      || record['Results'],
    );

    const frequency = parseNum(
      getFieldValue(record, headerMap, 'frequency')
      || record['Frequency'],
    ) || 1;

    const reach = parseNum(
      getFieldValue(record, headerMap, 'reach')
      || record['Reach'],
    );

    const costPerResult = cleanMonetaryValue(
      getFieldValue(record, headerMap, 'costPerResult')
      || pickColumn(record, 'Cost per result', 'Cost per Result', 'CPA'),
    );

    // ── Derived metrics ───────────────────────────────────────
    // CTR: results-as-proxy for clicks / impressions * 100
    const ctr  = impressions > 0 ? (results / impressions) * 100 : 0;
    const cpc  = results    > 0 ? spend / results            : 0;
    const roas = estimateRoas(ctr, frequency);

    const deliveryStatus = getFieldValue(record, headerMap, 'deliveryStatus')
      || String(record['Delivery status'] || 'unknown').trim();

    // Keep raw row for Claude context (the orchestrator can read any column)
    return {
      campaignId,
      campaignName,
      adsetName,
      deliveryStatus,
      spend:          round2(spend),
      impressions,
      results,
      frequency:      round2(frequency),
      reach,
      costPerResult:  round2(costPerResult),
      ctr:            round2(ctr),
      cpc:            round2(cpc),
      roas:           round2(roas),
      // Raw record forwarded to Claude via Action.payload
      rawRecord:      record,
    };

  } catch (err) {
    console.error('[metaAdsParser] buildCampaign error:', err.message);
    return null;
  }
}

/**
 * Get a field value from a record using the header map.
 * Falls back to direct field access if mapping fails.
 *
 * @param {object} record - CSV row
 * @param {object} headerMap - Raw header → standard field mapping
 * @param {string} fieldName - Standardized field name (e.g., 'spend')
 * @returns {string|null} - Field value, or null if not found
 */
function getFieldValue(record, headerMap, fieldName) {
  // Find the raw header that maps to this field
  const rawHeader = Object.keys(headerMap).find(
    (key) => headerMap[key] === fieldName,
  );

  if (rawHeader && record[rawHeader] !== undefined) {
    return record[rawHeader];
  }

  return null;
}

/**
 * Pick the first non-empty value from a list of possible column names.
 * Legacy fallback for direct column access.
 * Handles Meta's habit of appending currency to headers.
 *
 * @deprecated - Use headerMap + getFieldValue instead for new code
 */
function pickColumn(record, ...names) {
  for (const name of names) {
    if (record[name] !== undefined && record[name] !== null && record[name] !== '') {
      return record[name];
    }
  }
  // Fuzzy fallback: substring match (handles "Amount spent (USD)" etc.)
  for (const name of names) {
    const key = Object.keys(record).find(
      (k) => k.toLowerCase().includes(name.toLowerCase()),
    );
    if (key && record[key] !== '' && record[key] !== undefined) {
      return record[key];
    }
  }
  return '';
}

/**
 * Parse a numeric cell value (non-monetary).
 * Handles commas, spaces, empty strings, percentage signs.
 * For monetary values, use cleanMonetaryValue() instead.
 */
function parseNum(val) {
  if (val === null || val === undefined || val === '' || val === '-' || val === 'N/A') {
    return 0;
  }

  let str = String(val).trim();

  // Handle percentage values (e.g., "2.5%" → 2.5)
  const isPercentage = str.endsWith('%');
  if (isPercentage) {
    str = str.slice(0, -1).trim();
  }

  // Remove commas (thousands separators)
  str = str.replace(/,/g, '');

  // Remove currency symbols and other non-numeric chars (keep dot, minus)
  str = str.replace(/[^0-9.\-]/g, '');

  const num = parseFloat(str);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Estimate ROAS from CTR and frequency (Meta doesn't export ROAS).
 * Pure heuristic — real ROAS needs conversion value data.
 *
 * base = 1.5
 * ctr bonus  : +0.1 per 1 % CTR above 1 %
 * freq factor: -15 % per unit of frequency above 3
 */
function estimateRoas(ctr, frequency) {
  const base      = 1.5;
  const ctrBonus  = ctr > 1 ? (ctr - 1) * 0.1 : 0;
  const freqFactor = frequency > 3 ? 1 - (frequency - 3) * 0.15 : 1;
  return Math.max(0.1, (base + ctrBonus) * freqFactor);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

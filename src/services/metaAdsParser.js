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
//   - Currency column is "Amount spent (EGP)" not "Spend"
//   - No ROAS column — estimated from CTR + frequency
//   - "Results" = conversion count (not clicks)
// ============================================================
import { parse } from 'csv-parse/sync';

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

    const campaigns = [];
    const errors    = [];
    let   skipped   = 0;

    records.forEach((record, idx) => {
      // ── 3. Skip summary/total rows (empty Campaign name) ─────
      const campaignName = record['Campaign name']
        ? String(record['Campaign name']).trim()
        : '';

      if (!campaignName) {
        skipped++;
        return;
      }

      const campaign = buildCampaign(record);

      if (campaign) {
        campaigns.push(campaign);
      } else {
        errors.push(`Row ${idx + 2}: could not parse — skipped`);
      }
    });

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

function buildCampaign(record) {
  try {
    const campaignName = String(record['Campaign name'] || '').trim();
    const adsetName    = String(record['Ad set name']   || '').trim();

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

    // ── Parse numeric fields ──────────────────────────────────
    // Try "Amount spent (EGP)" first, then generic fallbacks.
    const spend = parseNum(
      pickColumn(record, 'Amount spent (EGP)', 'Amount spent', 'Spend', 'Cost'),
    );

    const impressions   = parseNum(record['Impressions']);
    const results       = parseNum(record['Results']);       // conversions
    const frequency     = parseNum(record['Frequency']) || 1;
    const reach         = parseNum(record['Reach']);
    const costPerResult = parseNum(
      pickColumn(record, 'Cost per result', 'Cost per Result', 'CPA'),
    );

    // ── Derived metrics ───────────────────────────────────────
    // CTR: results-as-proxy for clicks / impressions * 100
    const ctr  = impressions > 0 ? (results / impressions) * 100 : 0;
    const cpc  = results    > 0 ? spend / results            : 0;
    const roas = estimateRoas(ctr, frequency);

    const deliveryStatus = String(record['Delivery status'] || 'unknown').trim();

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
 * Pick the first non-empty value from a list of possible column names.
 * Handles Meta's habit of appending currency to headers.
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
 * Parse a numeric cell value.
 * Handles commas, currency symbols, spaces, empty strings.
 */
function parseNum(val) {
  if (val === null || val === undefined || val === '') return 0;
  const cleaned = String(val).replace(/[^0-9.\-]/g, '');
  const num     = parseFloat(cleaned);
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

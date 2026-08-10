// ============================================================
// MARCOM / LUMI — PDF Export  (Campaign Performance Report)
// ------------------------------------------------------------
// Executive report generated CLIENT-SIDE from the LIVE connector substrate
// (Campaign entities + verdict engine + Account Health), NOT the retired CSV
// feed. Every figure traces to a real row; a missing metric renders "—", never
// a fabricated 0 or "null / 100".
//
// Honesty rules enforced here:
//   • null health score → "— / 100" + neutral color (never green "null / 100")
//   • all SIX engine verdicts counted, collapsed into 3 lanes that sum to 100%
//   • gated (no-revenue) campaigns show "Add revenue data…", never a fake verdict
//   • spend is major-unit already (caller converts via fromMinor) → currency-safe
//
// Arabic: jsPDF ships no Unicode font, so we embed Noto Naskh Arabic (lazily, only
// on export) and let jsPDF's built-in processArabic (shaping) + BidiEngine (RTL)
// render real Arabic campaign names — no more "[Arabic]" marker.
//
// Currency: currencyFormatter.js is locale-aware (ar-EG → Arabic-Indic digits +
// Arabic symbol) which the PDF's Latin fonts CAN'T render. We use a PDF-only
// en-US formatter (formatCurrencyPdf) so money is always legible in the report.
// currencyFormatter.js is deliberately untouched (the UI stays ar-EG).
//
// Dark executive theme (app brand tokens). jsPDF + the Arabic font are dynamically
// imported inside generateCampaignReport so merely importing the pure helpers
// (tested below) never pulls the PDF engine or the font into the bundle/test.
// ============================================================
import { VERDICT_RANK } from './verdictRank.js';

// App design tokens (dark theme). Kept as hex; converted to rgb at draw time so
// we never depend on a particular jsPDF hex-parsing behavior.
const COLORS = {
  kill:    '#EF4444', // signal-kill
  reallocate: '#EF4444',
  scale:   '#10B981', // signal-scale
  hold:    '#6B7280', // signal-hold
  watch:   '#3B82F6', // signal-watch
  gold:    '#D4AF37', // lumi-gold
  amber:   '#F59E0B', // warning (distinct from brand gold)
  text:    '#F1F1F1', // lumi-text
  muted:   '#9CA3AF', // lumi-muted
  bg:      '#141414', // dark-base
  surface: '#1C1C1C', // lumi-surface
  border:  '#2A2A2A', // lumi-border
};

const TONE_COLOR = { neutral: COLORS.muted, danger: COLORS.kill, warning: COLORS.amber, success: COLORS.scale };

// Urgency rank IS CampaignsView's — imported, not mirrored. It used to be a
// local copy under a comment claiming it mirrored the table, and the two had
// drifted (REFRESH and REALLOCATE swapped), so the exported report ordered the
// same rows differently from the screen they were exported from.
// A gated/unknown verdict has no rank and sinks. Exported for the sort unit test.
export const byUrgency = (a, b) => (VERDICT_RANK[a.verdict] ?? 99) - (VERDICT_RANK[b.verdict] ?? 99);

// Hex → [r,g,b] so jsPDF setColor calls are unambiguous across versions.
function rgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** True when the string contains Arabic (U+0600–U+06FF). */
export function hasArabicText(text) {
  return /[؀-ۿ]/.test(text || '');
}

/**
 * Clean text for the report WITHOUT stripping Arabic — Arabic now renders via the
 * embedded Noto Naskh font. Removes control characters, collapses whitespace, and
 * returns "—" for empty input. Optional maxLen truncates with an ellipsis (default:
 * no truncation, for the header + text report).
 */
export function sanitizeText(text, maxLen = Infinity) {
  if (text == null) return '—';
  // Strip control chars (\p{Cc} — never Arabic) + collapse whitespace.
  const clean = String(text).replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return '—';
  return clean.length > maxLen ? `${clean.slice(0, maxLen - 1)}…` : clean;
}

/**
 * PDF-only currency formatter. Forces en-US (Western digits, Latin symbol) so
 * amounts are legible in the Latin-font PDF — currencyFormatter.js's locale output
 * (e.g. ar-EG "٤٬٢٤٢٫٠٧ ج.م.") would render as tofu. Whole numbers (executive
 * report). Spend is already major-unit; null/non-finite → "—".
 */
export function formatCurrencyPdf(amount, currency) {
  if (amount == null || !Number.isFinite(amount)) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
      // Intl separates the code with a non-breaking space; normalize to ASCII so
      // the Latin PDF font renders it cleanly (and the output is stable to test).
    }).format(amount).replace(/\s/g, ' ');
  } catch {
    return `${currency || ''} ${Math.round(amount).toLocaleString('en-US')}`.trim();
  }
}

// ── PURE HELPERS (exported for unit tests) ───────────────────

/**
 * Honest Account-Health display. A null score is NOT a failure and NOT a zero —
 * it renders "— / 100" in a neutral tone, never green "null / 100".
 * @returns {{ scoreText: string, labelText: string, tone: 'neutral'|'danger'|'warning'|'success' }}
 */
export function healthDisplay(healthScore, healthLabel) {
  if (healthScore == null) {
    return { scoreText: '— / 100', labelText: 'SYNC META TO SCORE', tone: 'neutral' };
  }
  const tone = healthScore < 40 ? 'danger' : healthScore < 70 ? 'warning' : 'success';
  return {
    scoreText: `${healthScore} / 100`,
    labelText: (healthLabel ?? '').toUpperCase() || '—',
    tone,
  };
}

// The three display lanes cover ALL six engine verdicts (nothing dropped).
export const VERDICT_LANES = [
  { key: 'kill',  label: 'KILL / REALLOCATE',      verdicts: ['KILL', 'REALLOCATE'],   colorKey: 'kill' },
  { key: 'hold',  label: 'HOLD / WATCH / REFRESH', verdicts: ['HOLD', 'WATCH', 'REFRESH'], colorKey: 'hold' },
  { key: 'scale', label: 'SCALE',                  verdicts: ['SCALE'],                colorKey: 'scale' },
];

/**
 * Verdict distribution over SCORED campaigns (a gated/null-verdict campaign is
 * not in the denominator — it's reported separately as "needs revenue data").
 * All six verdicts land in exactly one lane, and the three integer percentages
 * always sum to 100 (the last lane absorbs the rounding remainder).
 * @returns {Array<{ key, label, colorKey, count, pct }>}
 */
export function buildVerdictLanes(campaigns = []) {
  const scored = campaigns.filter((c) => c.verdict != null);
  const total = scored.length;
  const counts = VERDICT_LANES.map((l) => scored.filter((c) => l.verdicts.includes(c.verdict)).length);
  const pcts = counts.map((n) => (total > 0 ? Math.round((n / total) * 100) : 0));
  if (total > 0) pcts[2] = Math.max(0, 100 - pcts[0] - pcts[1]); // guarantee sum === 100
  return VERDICT_LANES.map((l, i) => ({
    key: l.key, label: l.label, colorKey: l.colorKey, count: counts[i], pct: pcts[i],
  }));
}

function verdictColor(v) {
  if (v === 'KILL' || v === 'REALLOCATE') return COLORS.kill;
  if (v === 'SCALE') return COLORS.scale;
  if (v === 'WATCH') return COLORS.watch;
  if (v == null) return COLORS.muted;
  return COLORS.hold; // HOLD / REFRESH
}

// ── MAIN: executive PDF ──────────────────────────────────────
/**
 * @param {Object}  data
 * @param {Array}   data.campaigns   - PDF rows { campaign, verdict, rationale, spend(major|null), roas, ctr(%|null), currency, needsRevenue }
 * @param {number?} data.healthScore - 0..100 or null
 * @param {string?} data.healthLabel - engine label or null
 * @param {number?} data.wastedSpend - major-unit wasted budget or null
 * @param {number?} data.wastedPct   - integer percent or null
 * @param {string?} data.generatedAt - ISO string
 * @param {string?} data.workspaceName
 */
export async function generateCampaignReport({
  campaigns = [],
  healthScore = null,
  healthLabel = null,
  wastedSpend = null,
  wastedPct = null,
  generatedAt = null,
  workspaceName = null,
}) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const M = 16;

  // Lazy-load the embedded Arabic font ONLY here so it code-splits with jsPDF and
  // never enters the main bundle. jsPDF's built-in processArabic (auto preProcessText
  // hook) shapes; its BidiEngine reorders via the RTL options in drawText/table.
  // If the module ever fails to load, Arabic degrades gracefully (Latin font, likely
  // blank glyphs) rather than crashing the export.
  let arabicReady = false;
  try {
    const { notoNaskhArabicBase64 } = await import('../assets/fonts/notoNaskhArabic.js');
    doc.addFileToVFS('NotoNaskhArabic-Regular.ttf', notoNaskhArabicBase64);
    doc.addFont('NotoNaskhArabic-Regular.ttf', 'NotoNaskh', 'normal');
    arabicReady = true;
  } catch {
    // keep going Latin-only — never fail the export over a font
  }

  const setLatin = (style = 'normal') => doc.setFont('helvetica', style);
  const setArabic = () => doc.setFont('NotoNaskh', 'normal');
  // Draw a (possibly Arabic) left-positioned string with the right font. Arabic uses
  // the embedded Noto Naskh with RTL bidi; everything else keeps the current Latin
  // font. Sanitizes + optionally truncates. Restores the Latin normal font after.
  const drawText = (text, x, y, { maxLen = Infinity, ...opts } = {}) => {
    const s = sanitizeText(text, maxLen);
    if (arabicReady && hasArabicText(s)) {
      setArabic();
      doc.text(s, x, y, { isInputRtl: true, isOutputVisual: true, ...opts });
      setLatin();
    } else {
      doc.text(s, x, y, opts);
    }
    return s;
  };

  const currency = campaigns.find((c) => c.currency)?.currency || 'USD';

  const paintBg = () => { doc.setFillColor(...rgb(COLORS.bg)); doc.rect(0, 0, pageWidth, pageHeight, 'F'); };
  const addPage = () => { doc.addPage(); paintBg(); return 20; };

  paintBg();
  let y = 18;

  // ── Header ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...rgb(COLORS.gold));
  doc.text('LUMI', M, y);

  const now = generatedAt ? new Date(generatedAt) : new Date();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...rgb(COLORS.muted));
  doc.text(now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }), pageWidth - M, y, { align: 'right' });

  y += 9;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...rgb(COLORS.text));
  doc.text('Campaign Performance Report', M, y);

  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...rgb(COLORS.muted));
  const sub = [
    workspaceName ? sanitizeText(workspaceName) : null,
    `${campaigns.length} campaign${campaigns.length === 1 ? '' : 's'}`,
    currency,
  ].filter(Boolean).join('   ·   ');
  // Draw inline (not via drawText) to preserve the wide "   ·   " separators, but
  // still route through the Arabic font if the workspace name is Arabic.
  if (arabicReady && hasArabicText(sub)) {
    setArabic();
    doc.text(sub, M, y, { isInputRtl: true, isOutputVisual: true });
    setLatin();
  } else {
    doc.text(sub, M, y);
  }

  y += 6;
  doc.setDrawColor(...rgb(COLORS.gold));
  doc.setLineWidth(0.6);
  doc.line(M, y, pageWidth - M, y);
  y += 10;

  // ── Account Health card ──
  const hd = healthDisplay(healthScore, healthLabel);
  const hColor = TONE_COLOR[hd.tone];
  doc.setFillColor(...rgb(COLORS.surface));
  doc.roundedRect(M, y, pageWidth - 2 * M, 24, 2, 2, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...rgb(COLORS.muted));
  doc.text('ACCOUNT HEALTH', M + 5, y + 8);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...rgb(hColor));
  doc.text(hd.scoreText, M + 5, y + 19);
  doc.setFontSize(10);
  doc.text(hd.labelText, M + 62, y + 19);
  if (healthScore != null) {
    const barX = pageWidth - M - 70, barY = y + 15, barW = 60, barH = 3;
    doc.setFillColor(...rgb(COLORS.border));
    doc.rect(barX, barY, barW, barH, 'F');
    doc.setFillColor(...rgb(hColor));
    doc.rect(barX, barY, barW * Math.max(0, Math.min(1, healthScore / 100)), barH, 'F');
  }
  y += 32;

  // ── Key metrics (3 cards) ──
  const totalSpend = campaigns.reduce((s, c) => s + (c.spend ?? 0), 0);
  const scaleSpend = campaigns.filter((c) => c.verdict === 'SCALE').reduce((s, c) => s + (c.spend ?? 0), 0);
  const wastedText = wastedSpend != null
    ? `${formatCurrencyPdf(wastedSpend, currency)}${wastedPct != null ? `  (${wastedPct}%)` : ''}`
    : '—';
  const metrics = [
    { label: 'TOTAL SPEND', value: formatCurrencyPdf(totalSpend, currency), color: COLORS.text },
    { label: 'WASTED BUDGET', value: wastedText, color: COLORS.kill },
    { label: 'SCALE OPPORTUNITY', value: formatCurrencyPdf(scaleSpend, currency), color: COLORS.scale },
  ];
  const gap = 4;
  const cardW = (pageWidth - 2 * M - 2 * gap) / 3;
  metrics.forEach((m, i) => {
    const x = M + i * (cardW + gap);
    doc.setFillColor(...rgb(COLORS.surface));
    doc.roundedRect(x, y, cardW, 20, 2, 2, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...rgb(COLORS.muted));
    doc.text(m.label, x + 4, y + 7);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...rgb(m.color));
    doc.text(String(m.value), x + 4, y + 15);
  });
  y += 28;

  // ── Verdict distribution (all 6 verdicts, 3 lanes summing to 100%) ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...rgb(COLORS.text));
  doc.text('Verdict Distribution', M, y);
  y += 7;
  buildVerdictLanes(campaigns).forEach((lane) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...rgb(COLORS.text));
    doc.text(lane.label, M, y);
    doc.setTextColor(...rgb(COLORS.muted));
    doc.text(`${lane.count}`, M + 74, y);
    const barX = M + 86, barW = pageWidth - M - barX - 14, barH = 4;
    doc.setFillColor(...rgb(COLORS.border));
    doc.rect(barX, y - 3, barW, barH, 'F');
    doc.setFillColor(...rgb(COLORS[lane.colorKey]));
    doc.rect(barX, y - 3, barW * (lane.pct / 100), barH, 'F');
    doc.setTextColor(...rgb(COLORS.muted));
    doc.text(`${lane.pct}%`, pageWidth - M, y, { align: 'right' });
    y += 8;
  });

  const gatedCount = campaigns.filter((c) => c.needsRevenue).length;
  if (gatedCount > 0) {
    doc.setFontSize(8);
    doc.setTextColor(...rgb(COLORS.muted));
    doc.text(`${gatedCount} campaign${gatedCount === 1 ? '' : 's'} need revenue data to be scored.`, M, y);
    y += 8;
  }
  y += 2;

  // ── Recommendations ──
  const drawReco = (title, list, color) => {
    if (list.length === 0) return;
    if (y > pageHeight - 40) y = addPage();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...rgb(color));
    doc.text(`${title} (${list.length})`, M, y);
    y += 6;
    list.forEach((c) => {
      if (y > pageHeight - 20) y = addPage();
      // Bullet + name: bullet stays Latin, the name renders in its own script.
      setLatin('bold');
      doc.setFontSize(8);
      doc.setTextColor(...rgb(COLORS.text));
      doc.text('•', M + 2, y);
      drawText(c.campaign, M + 6, y, { maxLen: 44 });
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...rgb(color));
      doc.text(c.verdict ?? '—', pageWidth - M, y, { align: 'right' });
      y += 4.5;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...rgb(COLORS.muted));
      drawText(c.rationale, M + 6, y, { maxLen: 90 });
      y += 7;
    });
    y += 2;
  };
  drawReco('Action Required', campaigns.filter((c) => c.verdict === 'KILL' || c.verdict === 'REALLOCATE').slice(0, 5), COLORS.kill);
  drawReco('Scale Opportunities', campaigns.filter((c) => c.verdict === 'SCALE').slice(0, 5), COLORS.scale);

  // ── Campaign details table (new page) ──
  y = addPage();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...rgb(COLORS.text));
  doc.text('Campaign Details', M, y);
  y += 9;

  const cols = { name: M + 2, verdict: M + 78, spend: M + 108, roas: M + 142, ctr: M + 164 };
  const drawHeader = () => {
    doc.setFillColor(...rgb(COLORS.surface));
    doc.rect(M, y - 4, pageWidth - 2 * M, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...rgb(COLORS.muted));
    doc.text('CAMPAIGN', cols.name, y);
    doc.text('VERDICT', cols.verdict, y);
    doc.text('SPEND', cols.spend, y);
    doc.text('ROAS', cols.roas, y);
    doc.text('CTR', cols.ctr, y);
    y += 6;
  };
  drawHeader();

  [...campaigns].sort(byUrgency).forEach((c, idx) => {
    if (y > pageHeight - 16) { y = addPage(); drawHeader(); }
    if (idx % 2 === 0) {
      doc.setFillColor(...rgb(COLORS.surface));
      doc.rect(M, y - 4, pageWidth - 2 * M, 5.5, 'F');
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...rgb(COLORS.text));
    // Name cell: Latin left-aligned; Arabic right-aligned to the column edge so it
    // reads correctly RTL (jsPDF shapes + reorders via the bidi options).
    const nm = sanitizeText(c.campaign, 36);
    if (arabicReady && hasArabicText(nm)) {
      setArabic();
      doc.text(nm, cols.verdict - 4, y, { isInputRtl: true, isOutputVisual: true, align: 'right' });
      setLatin();
    } else {
      doc.text(nm, cols.name, y);
    }
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...rgb(verdictColor(c.verdict)));
    doc.text(c.verdict ?? '—', cols.verdict, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...rgb(COLORS.text));
    doc.text(formatCurrencyPdf(c.spend, c.currency || currency), cols.spend, y);
    doc.text(c.roas == null ? '—' : `${c.roas.toFixed(2)}x`, cols.roas, y);
    doc.text(c.ctr == null ? '—' : `${c.ctr.toFixed(2)}%`, cols.ctr, y);
    y += 5.5;
  });

  // ── Footer (every page) ──
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...rgb(COLORS.muted));
    doc.text(`Generated by LUMI AI  ·  Page ${i} of ${pageCount}`, M, pageHeight - 8);
  }

  const stamp = now.toISOString().split('T')[0];
  doc.save(`LUMI_Campaign_Report_${stamp}.pdf`);
}

/**
 * Text fallback if jsPDF throws. Same connector-sourced data, same honesty rules.
 * Plain UTF-8 .txt renders Arabic natively, so names are preserved as-is.
 */
export function generateTextReport({
  campaigns = [],
  healthScore = null,
  healthLabel = null,
  wastedSpend = null,
  wastedPct = null,
}) {
  const currency = campaigns.find((c) => c.currency)?.currency || 'USD';
  const hd = healthDisplay(healthScore, healthLabel);
  const totalSpend = campaigns.reduce((s, c) => s + (c.spend ?? 0), 0);
  const gatedCount = campaigns.filter((c) => c.needsRevenue).length;

  const lines = [
    '='.repeat(60),
    'LUMI CAMPAIGN PERFORMANCE REPORT',
    `Generated: ${new Date().toLocaleString()}`,
    '='.repeat(60),
    '',
    'SUMMARY',
    '-'.repeat(60),
    `Campaigns: ${campaigns.length}`,
    `Total Spend: ${formatCurrencyPdf(totalSpend, currency)}`,
    `Health: ${hd.scoreText} (${hd.labelText})`,
    `Wasted: ${wastedSpend != null ? formatCurrencyPdf(wastedSpend, currency) : '—'}${wastedPct != null ? ` (${wastedPct}%)` : ''}`,
    '',
    'VERDICT DISTRIBUTION',
    ...buildVerdictLanes(campaigns).map((l) => `  ${l.label}: ${l.count} (${l.pct}%)`),
    ...(gatedCount > 0 ? [`  Needs revenue data: ${gatedCount}`] : []),
    '',
    'CAMPAIGN DETAILS',
    '-'.repeat(60),
  ];

  [...campaigns].sort(byUrgency).forEach((c) => {
    const cur = c.currency || currency;
    lines.push(
      `Campaign: ${sanitizeText(c.campaign)}`,
      `  Verdict: ${c.verdict ?? '—'} | Spend: ${formatCurrencyPdf(c.spend, cur)} | ROAS: ${c.roas == null ? '—' : `${c.roas.toFixed(2)}x`} | CTR: ${c.ctr == null ? '—' : `${c.ctr.toFixed(2)}%`}`,
      `  Reason: ${sanitizeText(c.rationale)}`,
      '',
    );
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `LUMI_Campaign_Report_${new Date().toISOString().split('T')[0]}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

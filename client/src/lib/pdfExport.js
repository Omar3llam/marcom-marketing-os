// ============================================================
// MARCOM PDF Export Utility — Executive Report Generator
// ============================================================
// Professional campaign analysis reports with:
// - Arabic text handling (UTF-8 safe)
// - Executive summary section
// - Metadata and branding
// - Color-coded verdicts
// - Structured recommendations
// ============================================================
import { formatCurrency } from './currencyFormatter.js';

/**
 * Remove or transliterate Arabic text to prevent encoding issues in PDF.
 * jsPDF doesn't support Arabic/RTL natively without custom fonts.
 *
 * @param {string} text - Text that may contain Arabic
 * @returns {string} - Safe text for PDF rendering
 */
function sanitizeText(text) {
  if (!text) return '';

  // Check if text contains Arabic characters (U+0600 to U+06FF)
  const hasArabic = /[؀-ۿ]/.test(text);

  if (hasArabic) {
    // Replace Arabic text with placeholder or remove it
    // Option 1: Remove Arabic entirely
    const cleaned = text.replace(/[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]+/g, '[Arabic Text]');
    return cleaned.trim();
  }

  return text;
}

/**
 * Generate and download a professional executive PDF report
 * @param {Object} data - Report data
 * @param {Array} data.campaigns - Campaign rows
 * @param {Object} data.totals - Aggregated totals
 * @param {number} data.healthScore - Overall health score (0-100)
 * @param {string} data.healthLabel - Health label (HEALTHY, IMPROVING, NEEDS ATTENTION)
 */
export async function generateCampaignReport({ campaigns, totals, healthScore, healthLabel }) {
  // Dynamic import to avoid bundling jsPDF if not needed
  const { jsPDF } = await import('jspdf');

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let yPos = 20;

  // Detect primary currency from campaigns
  const currency = campaigns[0]?.currency || 'USD';

  // Color palette
  const colors = {
    primary: [245, 201, 69],    // lumi-gold
    danger: [220, 38, 38],       // red
    warning: [234, 179, 8],      // yellow
    success: [34, 197, 94],      // green
    dark: [17, 24, 39],          // dark-base
    muted: [156, 163, 175],      // gray
  };

  // ══════════════════════════════════════════════════════════
  // 1. COVER / HEADER SECTION
  // ══════════════════════════════════════════════════════════

  // Title
  doc.setFontSize(24);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...colors.dark);
  doc.text('MARCOM', pageWidth / 2, yPos, { align: 'center' });

  yPos += 8;
  doc.setFontSize(16);
  doc.setTextColor(...colors.muted);
  doc.text('Campaign Analysis Report', pageWidth / 2, yPos, { align: 'center' });

  yPos += 15;

  // Metadata section
  doc.setFontSize(9);
  doc.setTextColor(...colors.muted);
  const now = new Date();
  const metadata = [
    `Generated: ${now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} at ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
    `Currency: ${currency}`,
    `Campaigns Analyzed: ${campaigns.length}`,
    `Powered by LUMI AI`,
  ];

  metadata.forEach(line => {
    doc.text(line, pageWidth / 2, yPos, { align: 'center' });
    yPos += 4;
  });

  yPos += 10;

  // Divider line
  doc.setDrawColor(...colors.primary);
  doc.setLineWidth(0.5);
  doc.line(15, yPos, pageWidth - 15, yPos);
  yPos += 12;

  // ══════════════════════════════════════════════════════════
  // 2. EXECUTIVE SUMMARY — Account Health
  // ══════════════════════════════════════════════════════════

  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...colors.dark);
  doc.text('ACCOUNT HEALTH', pageWidth / 2, yPos, { align: 'center' });
  yPos += 10;

  // Health score card (large centered)
  const healthColor = healthScore < 40 ? colors.danger
                    : healthScore < 70 ? colors.warning
                    : colors.success;

  doc.setFillColor(...healthColor);
  doc.roundedRect(pageWidth / 2 - 35, yPos - 8, 70, 20, 3, 3, 'F');

  doc.setFontSize(28);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(`${healthScore} / 100`, pageWidth / 2, yPos + 4, { align: 'center' });

  yPos += 18;
  doc.setFontSize(11);
  doc.setTextColor(...healthColor);
  doc.text(healthLabel.toUpperCase(), pageWidth / 2, yPos, { align: 'center' });

  yPos += 15;

  // ══════════════════════════════════════════════════════════
  // 3. KEY METRICS — 3-column layout
  // ══════════════════════════════════════════════════════════

  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...colors.dark);
  doc.text('Key Metrics', 15, yPos);
  yPos += 8;

  const colWidth = (pageWidth - 40) / 3;
  const metrics = [
    { label: 'Total Spend', value: formatCurrency(totals.spend, currency), color: colors.dark },
    { label: 'Wasted Budget', value: formatCurrency(totals.kill, currency), color: colors.danger },
    { label: 'Scale Opportunity', value: formatCurrency(totals.scale, currency), color: colors.success },
  ];

  metrics.forEach((metric, i) => {
    const x = 15 + (i * colWidth);

    // Card background
    doc.setFillColor(250, 250, 250);
    doc.roundedRect(x, yPos - 3, colWidth - 5, 18, 2, 2, 'F');

    // Label
    doc.setFontSize(8);
    doc.setTextColor(...colors.muted);
    doc.text(metric.label, x + 3, yPos + 2);

    // Value
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...metric.color);
    doc.text(metric.value, x + 3, yPos + 10);
  });

  yPos += 22;

  // ══════════════════════════════════════════════════════════
  // 4. VERDICT DISTRIBUTION
  // ══════════════════════════════════════════════════════════

  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...colors.dark);
  doc.text('Verdict Distribution', 15, yPos);
  yPos += 8;

  const verdictData = [
    {
      label: 'KILL',
      count: campaigns.filter(c => c.verdict === 'KILL').length,
      amount: totals.kill,
      color: colors.danger,
      icon: '🔴'
    },
    {
      label: 'HOLD',
      count: campaigns.filter(c => c.verdict === 'HOLD').length,
      amount: totals.hold,
      color: colors.warning,
      icon: '🟡'
    },
    {
      label: 'SCALE',
      count: campaigns.filter(c => c.verdict === 'SCALE').length,
      amount: totals.scale,
      color: colors.success,
      icon: '🟢'
    },
  ];

  verdictData.forEach((v, i) => {
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...colors.dark);

    // Icon + Label
    doc.text(`${v.icon} ${v.label}`, 20, yPos);

    // Count + Amount
    doc.setTextColor(...v.color);
    doc.text(`${v.count} campaigns`, 50, yPos);
    doc.text(formatCurrency(v.amount, currency), 95, yPos);

    // Percentage bar
    const barWidth = 80;
    const barHeight = 4;
    const percentage = totals.spend > 0 ? (v.amount / totals.spend) : 0;
    const filledWidth = barWidth * percentage;

    // Background
    doc.setFillColor(240, 240, 240);
    doc.rect(140, yPos - 3, barWidth, barHeight, 'F');

    // Filled portion
    if (filledWidth > 0) {
      doc.setFillColor(...v.color);
      doc.rect(140, yPos - 3, filledWidth, barHeight, 'F');
    }

    // Percentage text
    doc.setFontSize(8);
    doc.setTextColor(...colors.muted);
    doc.text(`${Math.round(percentage * 100)}%`, 225, yPos);

    yPos += 8;
  });

  yPos += 5;

  // ══════════════════════════════════════════════════════════
  // 5. RECOMMENDATIONS SECTION
  // ══════════════════════════════════════════════════════════

  if (yPos > 220) {
    doc.addPage();
    yPos = 20;
  }

  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...colors.dark);
  doc.text('AI Recommendations', 15, yPos);
  yPos += 8;

  const killCampaigns = campaigns.filter(c => c.verdict === 'KILL').slice(0, 5);
  const scaleCampaigns = campaigns.filter(c => c.verdict === 'SCALE').slice(0, 5);

  if (killCampaigns.length > 0) {
    // Immediate actions header
    doc.setFillColor(254, 242, 242);
    doc.rect(15, yPos - 3, pageWidth - 30, 8, 'F');

    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...colors.danger);
    doc.text('🔴 IMMEDIATE ACTIONS — Stop These Campaigns', 20, yPos + 2);
    yPos += 10;

    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...colors.dark);

    killCampaigns.forEach((campaign, i) => {
      if (yPos > 270) {
        doc.addPage();
        yPos = 20;
      }

      const campaignName = sanitizeText(campaign.campaign);
      const reasoning = sanitizeText(campaign.reasoning || 'Poor performance');

      doc.text(`${i + 1}.`, 20, yPos);
      doc.setFont(undefined, 'bold');
      doc.text(campaignName.substring(0, 40), 25, yPos);

      yPos += 4;
      doc.setFont(undefined, 'normal');
      doc.setTextColor(...colors.muted);
      doc.text(`   ${reasoning.substring(0, 80)}`, 25, yPos);
      doc.setTextColor(...colors.dark);

      yPos += 6;
    });

    yPos += 3;
  }

  if (scaleCampaigns.length > 0) {
    if (yPos > 240) {
      doc.addPage();
      yPos = 20;
    }

    // Scale opportunities header
    doc.setFillColor(240, 253, 244);
    doc.rect(15, yPos - 3, pageWidth - 30, 8, 'F');

    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...colors.success);
    doc.text('🟢 SCALE OPPORTUNITIES — Increase Budget', 20, yPos + 2);
    yPos += 10;

    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...colors.dark);

    scaleCampaigns.forEach((campaign, i) => {
      if (yPos > 270) {
        doc.addPage();
        yPos = 20;
      }

      const campaignName = sanitizeText(campaign.campaign);
      const reasoning = sanitizeText(campaign.reasoning || 'Strong performance');

      doc.text(`${i + 1}.`, 20, yPos);
      doc.setFont(undefined, 'bold');
      doc.text(campaignName.substring(0, 40), 25, yPos);

      yPos += 4;
      doc.setFont(undefined, 'normal');
      doc.setTextColor(...colors.muted);
      doc.text(`   ${reasoning.substring(0, 80)}`, 25, yPos);
      doc.setTextColor(...colors.dark);

      yPos += 6;
    });
  }

  // ══════════════════════════════════════════════════════════
  // 6. CAMPAIGN DETAILS TABLE
  // ══════════════════════════════════════════════════════════

  doc.addPage();
  yPos = 20;

  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...colors.dark);
  doc.text('Campaign Details', 15, yPos);
  yPos += 8;

  doc.setFontSize(8);
  doc.setFont(undefined, 'normal');

  // Table header
  doc.setFillColor(...colors.primary);
  doc.rect(15, yPos - 4, pageWidth - 30, 6, 'F');
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...colors.dark);
  doc.text('Campaign', 20, yPos);
  doc.text('Verdict', 90, yPos);
  doc.text(`Spend (${currency})`, 115, yPos);
  doc.text('ROAS', 155, yPos);
  doc.text('CTR', 175, yPos);
  yPos += 6;

  // Table rows (limit to first 25)
  doc.setFont(undefined, 'normal');
  const displayCampaigns = campaigns.slice(0, 25);

  displayCampaigns.forEach((campaign, idx) => {
    if (yPos > 275) {
      doc.addPage();
      yPos = 20;
    }

    // Alternating row background
    if (idx % 2 === 0) {
      doc.setFillColor(250, 250, 250);
      doc.rect(15, yPos - 4, pageWidth - 30, 5, 'F');
    }

    // Campaign name (sanitized for Arabic)
    const campaignName = sanitizeText(campaign.campaign);
    doc.setTextColor(...colors.dark);
    doc.text(campaignName.substring(0, 35), 20, yPos);

    // Verdict (color-coded)
    const verdictColor = campaign.verdict === 'KILL' ? colors.danger
                       : campaign.verdict === 'SCALE' ? colors.success
                       : colors.warning;
    doc.setTextColor(...verdictColor);
    doc.setFont(undefined, 'bold');
    doc.text(campaign.verdict, 90, yPos);

    // Metrics
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...colors.dark);
    // Missing metric → em-dash, never a fabricated 0.00 (matches the table).
    doc.text(campaign.spend == null ? '—' : formatCurrency(campaign.spend, campaign.currency || currency), 115, yPos);
    doc.text(campaign.roas == null ? '—' : `${campaign.roas.toFixed(2)}x`, 155, yPos);
    doc.text(campaign.ctr  == null ? '—' : `${campaign.ctr.toFixed(2)}%`, 175, yPos);

    yPos += 5;
  });

  if (campaigns.length > 25) {
    yPos += 3;
    doc.setTextColor(...colors.muted);
    doc.setFontSize(8);
    doc.text(`... and ${campaigns.length - 25} more campaigns`, 20, yPos);
  }

  // ══════════════════════════════════════════════════════════
  // 7. FOOTER (on every page)
  // ══════════════════════════════════════════════════════════

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...colors.muted);
    doc.text(
      `MARCOM AI — Page ${i} of ${pageCount}`,
      pageWidth / 2,
      pageHeight - 10,
      { align: 'center' }
    );
  }

  // ══════════════════════════════════════════════════════════
  // 8. SAVE PDF
  // ══════════════════════════════════════════════════════════

  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const filename = `MARCOM_Executive_Report_${timestamp}.pdf`;

  doc.save(filename);
}

/**
 * Fallback: Generate a simple text-based report if jsPDF fails
 */
export function generateTextReport({ campaigns, totals, healthScore, healthLabel }) {
  const currency = campaigns[0]?.currency || 'USD';

  const lines = [
    '='.repeat(60),
    'MARCOM CAMPAIGN ANALYSIS REPORT',
    `Generated: ${new Date().toLocaleString()}`,
    '='.repeat(60),
    '',
    'SUMMARY',
    '-'.repeat(60),
    `Total Campaigns: ${campaigns.length}`,
    `Total Spend: ${formatCurrency(totals.spend, currency)}`,
    `Health Score: ${healthScore}/100 (${healthLabel})`,
    `Wasted Spend: ${totals.wastedPct}%`,
    '',
    'VERDICT BREAKDOWN',
    `  KILL:  ${formatCurrency(totals.kill, currency)} (${campaigns.filter(c => c.verdict === 'KILL').length} campaigns)`,
    `  HOLD:  ${formatCurrency(totals.hold, currency)} (${campaigns.filter(c => c.verdict === 'HOLD').length} campaigns)`,
    `  SCALE: ${formatCurrency(totals.scale, currency)} (${campaigns.filter(c => c.verdict === 'SCALE').length} campaigns)`,
    '',
    'CAMPAIGN DETAILS',
    '-'.repeat(60),
  ];

  campaigns.forEach(campaign => {
    const campaignCurrency = campaign.currency || currency;
    const campaignName = sanitizeText(campaign.campaign);
    lines.push(
      `Campaign: ${campaignName}`,
      `  Verdict: ${campaign.verdict} | Spend: ${campaign.spend == null ? '—' : formatCurrency(campaign.spend, campaignCurrency)} | ROAS: ${campaign.roas == null ? '—' : `${campaign.roas.toFixed(2)}x`} | CTR: ${campaign.ctr == null ? '—' : `${campaign.ctr.toFixed(2)}%`}`,
      `  Reason: ${sanitizeText(campaign.reasoning)}`,
      ''
    );
  });

  const text = lines.join('\n');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `MARCOM_Report_${new Date().toISOString().split('T')[0]}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

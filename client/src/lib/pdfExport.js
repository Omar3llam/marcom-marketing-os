// ============================================================
// MARCOM PDF Export Utility
// ------------------------------------------------------------
// Generates PDF reports from campaign analysis data
// ============================================================
import { formatCurrency } from './currencyFormatter.js';

/**
 * Generate and download a PDF report of campaign analysis
 * @param {Object} data - Report data
 * @param {Array} data.campaigns - Campaign rows
 * @param {Object} data.totals - Aggregated totals
 * @param {number} data.healthScore - Overall health score
 * @param {string} data.healthLabel - Health label
 */
export async function generateCampaignReport({ campaigns, totals, healthScore, healthLabel }) {
  // Dynamic import to avoid bundling jsPDF if not needed
  const { jsPDF } = await import('jspdf');

  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let yPos = 20;

  // Detect primary currency from campaigns
  const currency = campaigns[0]?.currency || 'USD';

  // Title
  doc.setFontSize(20);
  doc.setFont(undefined, 'bold');
  doc.text('MARCOM Campaign Analysis Report', pageWidth / 2, yPos, { align: 'center' });

  yPos += 10;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(100);
  doc.text(`Generated: ${new Date().toLocaleString('en-EG')}`, pageWidth / 2, yPos, { align: 'center' });

  yPos += 15;

  // Summary Section
  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(0);
  doc.text('Campaign Summary', 15, yPos);

  yPos += 8;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');

  const summaryLines = [
    `Total Campaigns: ${campaigns.length}`,
    `Total Spend: ${formatCurrency(totals.spend, currency)}`,
    `Health Score: ${healthScore}/100 (${healthLabel})`,
    `Wasted Spend: ${totals.wastedPct}%`,
    '',
    'Verdict Breakdown:',
    `  KILL: ${formatCurrency(totals.kill, currency)} (${campaigns.filter(c => c.verdict === 'KILL').length} campaigns)`,
    `  HOLD: ${formatCurrency(totals.hold, currency)} (${campaigns.filter(c => c.verdict === 'HOLD').length} campaigns)`,
    `  SCALE: ${formatCurrency(totals.scale, currency)} (${campaigns.filter(c => c.verdict === 'SCALE').length} campaigns)`,
  ];

  summaryLines.forEach(line => {
    doc.text(line, 15, yPos);
    yPos += 5;
  });

  yPos += 5;

  // Campaign Details Section
  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text('Campaign Details', 15, yPos);
  yPos += 8;

  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');

  // Table header
  doc.setFillColor(245, 201, 69); // lumi-gold
  doc.rect(15, yPos - 4, pageWidth - 30, 6, 'F');
  doc.setFont(undefined, 'bold');
  doc.text('Campaign', 20, yPos);
  doc.text('Verdict', 80, yPos);
  doc.text(`Spend (${currency})`, 110, yPos);
  doc.text('ROAS', 145, yPos);
  doc.text('CTR%', 165, yPos);
  yPos += 6;

  // Table rows (limit to first 30 to avoid page overflow)
  doc.setFont(undefined, 'normal');
  const displayCampaigns = campaigns.slice(0, 30);

  displayCampaigns.forEach((campaign, idx) => {
    // Check if we need a new page
    if (yPos > 270) {
      doc.addPage();
      yPos = 20;
    }

    // Alternating row background
    if (idx % 2 === 0) {
      doc.setFillColor(250, 250, 250);
      doc.rect(15, yPos - 4, pageWidth - 30, 5, 'F');
    }

    // Verdict color
    const verdictColor = campaign.verdict === 'KILL' ? [220, 38, 38]
                       : campaign.verdict === 'SCALE' ? [34, 197, 94]
                       : [234, 179, 8];

    doc.setTextColor(0);
    doc.text(campaign.campaign.substring(0, 28), 20, yPos);

    doc.setTextColor(...verdictColor);
    doc.text(campaign.verdict, 80, yPos);

    doc.setTextColor(0);
    doc.text(campaign.spend.toFixed(2), 110, yPos);
    doc.text(campaign.roas.toFixed(2), 145, yPos);
    doc.text(campaign.ctr.toFixed(2), 165, yPos);

    yPos += 5;
  });

  if (campaigns.length > 30) {
    yPos += 5;
    doc.setTextColor(100);
    doc.setFontSize(8);
    doc.text(`... and ${campaigns.length - 30} more campaigns`, 15, yPos);
  }

  // AI Recommendations Section
  yPos += 10;
  if (yPos > 250) {
    doc.addPage();
    yPos = 20;
  }

  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(0);
  doc.text('AI Recommendations', 15, yPos);
  yPos += 8;

  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');

  const killCampaigns = campaigns.filter(c => c.verdict === 'KILL');
  const scaleCampaigns = campaigns.filter(c => c.verdict === 'SCALE');

  if (killCampaigns.length > 0) {
    doc.setFont(undefined, 'bold');
    doc.text('Urgent: Stop These Campaigns', 15, yPos);
    yPos += 6;
    doc.setFont(undefined, 'normal');
    killCampaigns.slice(0, 5).forEach(campaign => {
      doc.text(`• ${campaign.campaign}: ${campaign.reasoning}`, 20, yPos);
      yPos += 5;
    });
    yPos += 3;
  }

  if (scaleCampaigns.length > 0) {
    if (yPos > 260) {
      doc.addPage();
      yPos = 20;
    }
    doc.setFont(undefined, 'bold');
    doc.text('Opportunity: Scale These Campaigns', 15, yPos);
    yPos += 6;
    doc.setFont(undefined, 'normal');
    scaleCampaigns.slice(0, 5).forEach(campaign => {
      doc.text(`• ${campaign.campaign}: ${campaign.reasoning}`, 20, yPos);
      yPos += 5;
    });
  }

  // Footer
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `MARCOM AI — Page ${i} of ${pageCount}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: 'center' }
    );
  }

  // Generate filename with timestamp
  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const filename = `MARCOM_Report_${timestamp}.pdf`;

  // Download
  doc.save(filename);
}

/**
 * Fallback: Generate a simple text-based report if jsPDF is not available
 */
export function generateTextReport({ campaigns, totals, healthScore, healthLabel }) {
  // Detect primary currency from campaigns
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
    lines.push(
      `Campaign: ${campaign.campaign}`,
      `  Verdict: ${campaign.verdict} | Spend: ${formatCurrency(campaign.spend, campaignCurrency)} | ROAS: ${campaign.roas.toFixed(2)} | CTR: ${campaign.ctr.toFixed(2)}%`,
      `  Reason: ${campaign.reasoning}`,
      ''
    );
  });

  const text = lines.join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `MARCOM_Report_${new Date().toISOString().split('T')[0]}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================
// portfolioAnalysisPrompt — grounded + honest by construction
// ------------------------------------------------------------
// The prompt is the only thing standing between a real advisory and a fabricated
// one. These pin the honesty rules: no forced decisiveness, unknowns stay
// unknown, and an unmeasured conversion campaign is named a tracking gap rather
// than a bad campaign.
// ============================================================
import { describe, expect, it } from 'vitest';
import { buildPortfolioAnalysisPrompt, CAMPAIGN_LIMIT } from './portfolioAnalysisPrompt.js';

const stats = {
  total: 2,
  verdictCounts: { KILL: 1, SCALE: 1 },
  healthScore: 62,
  healthLabel: 'Fair',
  wastedPct: 12.5,
  needsRevenueCount: 1,
};
const campaigns = [
  { name: 'Ramadan Cold', channel: 'META', objective: 'OUTCOME_SALES', verdict: 'KILL', spendMinor: 1_416_000, roas: null, ctr: 0.01, frequency: 4.2, needsRevenue: true },
  { name: 'PMax Warm', channel: 'GOOGLE', objective: 'OUTCOME_SALES', verdict: 'SCALE', spendMinor: 200_000, roas: 4.8, ctr: 0.02, frequency: 1.4, needsRevenue: false },
];
const workspace = { name: 'Acme', currency: 'EGP', objective: 'growth', market: 'EG' };

describe('buildPortfolioAnalysisPrompt — honesty rules', () => {
  it('forbids inventing data and re-assigning verdicts', () => {
    const { system } = buildPortfolioAnalysisPrompt(stats, campaigns, workspace);
    expect(system).toMatch(/Never invent/i);
    expect(system).toMatch(/never contradict or re-assign a deterministic verdict/i);
  });

  it('explicitly refuses to manufacture urgency (a stable portfolio is a valid finding)', () => {
    const { system } = buildPortfolioAnalysisPrompt(stats, campaigns, workspace);
    expect(system).toMatch(/do not manufacture urgency/i);
    expect(system).toMatch(/nothing needs action today/i);
    // The spec's "at least 1 campaign should be KILL or SCALE" pressure must NOT exist.
    expect(system).not.toMatch(/at least (one|1)/i);
  });

  it('names an unmeasured conversion campaign a MEASUREMENT GAP, not a bad campaign', () => {
    const { system } = buildPortfolioAnalysisPrompt(stats, campaigns, workspace);
    expect(system).toMatch(/MEASUREMENT GAP/);
    expect(system).toMatch(/Never call such a campaign bad/i);
  });
});

describe('buildPortfolioAnalysisPrompt — grounding', () => {
  it('renders real metrics and the deterministic verdict per campaign', () => {
    const { user } = buildPortfolioAnalysisPrompt(stats, campaigns, workspace);
    expect(user).toContain('"Ramadan Cold" (META)');
    expect(user).toContain('verdict (deterministic): KILL');
    expect(user).toContain('4.80x');          // real roas
    expect(user).toContain('14,160 EGP');     // minor units → display, workspace currency
    expect(user).toContain('2.00%');          // ctr
  });

  it('a null roas on a needs-revenue campaign reads as a tracking gap, never 0.00x', () => {
    const { user } = buildPortfolioAnalysisPrompt(stats, campaigns, workspace);
    expect(user).toContain('no revenue measured (tracking gap)');
    expect(user).not.toContain('0.00x');
  });

  it('absent metrics render "unknown" — never a fabricated zero', () => {
    const { user } = buildPortfolioAnalysisPrompt(
      { total: 1, needsRevenueCount: 0 },
      [{ name: 'Cold', channel: 'META', spendMinor: 1000, roas: null, ctr: null, frequency: null, needsRevenue: false }],
      workspace,
    );
    expect(user).toContain('ctr: unknown');
    expect(user).toContain('frequency: unknown');
    expect(user).toContain('objective: unknown');
  });

  it('carries the deterministic verdict mix + needs-revenue count', () => {
    const { user } = buildPortfolioAnalysisPrompt(stats, campaigns, workspace);
    expect(user).toContain('KILL 1');
    expect(user).toContain('SCALE 1');
    expect(user).toContain('Campaigns whose ROAS cannot be scored (no revenue measured): 1');
  });

  it('caps the campaign slice but still reports the true total (never shrinks the account)', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `C${i}`, channel: 'META', spendMinor: 100, needsRevenue: false }));
    const { user } = buildPortfolioAnalysisPrompt({ total: 30, needsRevenueCount: 0 }, many, workspace);
    expect(user).toContain('Campaigns with spend: 30');
    expect(user).toContain(`CAMPAIGNS (top ${CAMPAIGN_LIMIT} by spend)`);
    expect(user).not.toContain('"C29"');
  });
});

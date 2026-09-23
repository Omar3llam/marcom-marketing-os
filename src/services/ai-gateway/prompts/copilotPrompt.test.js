// ============================================================
// copilotPrompt — pure prompt-builder tests
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildCopilotSystemPrompt, buildCopilotUserPrompt } from './copilotPrompt.js';

describe('buildCopilotSystemPrompt', () => {
  const workspace = { name: 'Acme', currency: 'EGP', objective: 'sales', industry: 'retail', market: 'EG' };
  const campaigns = [
    { name: 'Ramadan Wave', channel: 'meta', verdict: 'KILL', rationale: 'ROAS below breakeven', roas: 0.8, ctr: 0.012, frequency: 4.2, spendMinor: 1234500, currency: 'EGP', monetaryStatus: 'MONETARY_VALID', conversions: 12, revenueMinor: 900000 },
  ];
  const portfolio = {
    totalCampaigns: 44,
    currency: 'EGP',
    currencyStatus: 'HOMOGENEOUS_AUTHORITATIVE',
    monetaryStatus: 'MONETARY_VALID',
    health: { score: 38, label: 'NEEDS ATTENTION', wastedSpendMinor: 250000, criticalCampaigns: 3, healthyCampaigns: 1 },
    totals: null,
  };
  const build = (over = {}) => buildCopilotSystemPrompt({ workspace, portfolio, campaigns, briefing: null, ...over });

  it('injects workspace context + campaign facts (grounding)', () => {
    const s = build({ briefing: 'Two campaigns need attention.' });
    expect(s).toContain('WORKSPACE: Acme');
    expect(s).toContain('CURRENCY: EGP');
    expect(s).toContain('Ramadan Wave (meta)');
    expect(s).toContain('→ KILL');
    expect(s).toContain('ROAS: 0.80x');
    expect(s).toContain('CTR: 1.20%');
    expect(s).toContain('Freq: 4.2');
    expect(s).toContain('ACCOUNT BRIEFING:');
  });

  // Same class as portfolioAnalysisPrompt: a hardcoded /100 overstated every
  // Gulf-dinar figure 10x, and the Copilot answers questions ABOUT these numbers.
  it('renders a 3-decimal currency at its true value, never 10x (KWD = 1000 fils)', () => {
    const s = build({
      workspace: { ...workspace, currency: 'KWD' },
      campaigns: [{ ...campaigns[0], spendMinor: 1_416_000, currency: 'KWD' }],
    });
    expect(s).toMatch(/KWD\s1,416\.000/); // 1_416_000 fils = 1,416 KWD (Intl NBSP)
    expect(s).not.toContain('14,160');    // the /100 answer
  });

  it('renders Latin digits for an Arabic-locale currency', () => {
    expect(build()).not.toMatch(/[٠-٩]/); // formatCurrency defaults to ar-EG; we pin en-US
  });

  it('forbids fabrication + demands honesty in the rules', () => {
    const s = build();
    expect(s).toMatch(/[Nn]ever fabricate/);
    expect(s).toMatch(/say so plainly/i);
    expect(s).not.toContain('ACCOUNT BRIEFING'); // omitted when no briefing
  });

  it('is honest when no campaigns are synced', () => {
    const s = build({ campaigns: [], portfolio: { ...portfolio, totalCampaigns: 0 } });
    expect(s).toContain('No campaigns synced yet.');
  });

  it('never throws on empty/undefined inputs', () => {
    expect(() => buildCopilotSystemPrompt()).not.toThrow();
    expect(buildCopilotSystemPrompt()).toContain('WORKSPACE: Unknown');
    expect(buildCopilotSystemPrompt()).toContain('ACCOUNT HEALTH: unavailable');
  });

  // ── PR: portfolio context + grounded limitations ─────────────
  describe('account health block', () => {
    it('renders the deterministic health score + wasted spend', () => {
      const s = build();
      expect(s).toContain('ACCOUNT HEALTH');
      expect(s).toContain('Score: 38/100 (NEEDS ATTENTION)');
      expect(s).toContain('Wasted spend');
      expect(s).toMatch(/Wasted spend: EGP\s2,500\.00/);
    });

    it('names the counts by verdict so "critical" cannot be misread as the health label', () => {
      const s = build();
      expect(s).toContain('Campaigns to act on (KILL or REFRESH): 3');
      expect(s).toContain('Campaigns scaling well (SCALE): 1');
    });

    it('is honestly unavailable when health could not be computed', () => {
      const s = build({ portfolio: { ...portfolio, health: null } });
      expect(s).toContain('ACCOUNT HEALTH: unavailable');
      expect(s).not.toContain('Score:');
    });

    it('preserves verdict counts while withholding mixed-currency score and money', () => {
      const s = build({
        campaigns: [],
        portfolio: {
          ...portfolio,
          currency: null,
          currencyStatus: 'MIXED',
          health: {
            score: null,
            label: null,
            currencyUnavailable: 'MIXED_CURRENCY',
            wastedSpendMinor: null,
            criticalCampaigns: 3,
            healthyCampaigns: 1,
          },
        },
      });
      expect(s).toContain('CURRENCY: unavailable (MIXED)');
      expect(s).toContain('Score: unavailable (MIXED_CURRENCY)');
      expect(s).toContain('Wasted spend: unavailable');
      expect(s).toContain('Campaigns to act on (KILL or REFRESH): 3');
      expect(s).toContain('CAMPAIGN DETAILS: unavailable');
      expect(s).not.toContain('top 0 of 44 by spend');
    });
  });

  describe('slice disclosure', () => {
    it('states it is showing a top-N slice of the real total', () => {
      const s = build();
      expect(s).toContain('top 1 of 44');
      expect(s).toContain('43 additional campaigns are not shown');
    });

    it('answers "how many campaigns" with the TOTAL, not the slice size', () => {
      const s = build();
      expect(s).toContain('44 campaigns');
    });

    it('omits the "not shown" note when the slice IS the whole account', () => {
      const s = build({ portfolio: { ...portfolio, totalCampaigns: 1 } });
      expect(s).toContain('top 1 of 1');
      expect(s).not.toContain('additional campaigns are not shown');
    });
  });

  describe('grounded limitations', () => {
    it('labels present metrics rather than dropping them', () => {
      const s = build();
      expect(s).toContain('Conversions: 12');
      expect(s).toMatch(/Revenue: EGP\s9,000\.00/);
    });

    it('prints "unavailable" for a null metric so the model can NAME what is missing', () => {
      const s = build({ campaigns: [{ ...campaigns[0], conversions: null, revenueMinor: null, roas: null }] });
      expect(s).toContain('Conversions: unavailable');
      expect(s).toContain('Revenue: unavailable');
      expect(s).toContain('ROAS: unavailable');
    });

    it('keeps a measured zero distinct from an absent metric', () => {
      const s = build({ campaigns: [{ ...campaigns[0], conversions: 0 }] });
      expect(s).toContain('Conversions: 0');
    });

    it('forbids the vague no-access answer and demands the missing metric be named', () => {
      const s = build();
      expect(s).not.toContain("I don't have access");
      expect(s).toMatch(/name the exact metric that is absent/i);
    });

    it('states the data is a snapshot, not a trend, and injects no date', () => {
      const s = build();
      expect(s).toMatch(/latest available snapshot, not a historical trend/i);
      expect(s).toMatch(/no period-over-period comparison/i);
      expect(s).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no ISO date anywhere
    });

    it('says CPA is underivable without conversions — and gives no workflow advice', () => {
      const s = build();
      expect(s).toMatch(/CPA cannot be derived/i);
      expect(s).not.toContain('Upload revenue CSV');
    });
  });
});

describe('buildCopilotUserPrompt', () => {
  it('returns just the question when there is no history', () => {
    expect(buildCopilotUserPrompt([], 'Why did CPA jump?')).toBe('Why did CPA jump?');
  });

  it('renders a labelled transcript before the current question', () => {
    const u = buildCopilotUserPrompt(
      [{ role: 'user', content: 'Which to pause?' }, { role: 'assistant', content: 'Ramadan Wave.' }],
      'Why that one?',
    );
    expect(u).toContain('User: Which to pause?');
    expect(u).toContain('Lumi: Ramadan Wave.');
    expect(u).toContain('Current question: Why that one?');
  });

  it('drops malformed turns', () => {
    const u = buildCopilotUserPrompt([{ role: 'system', content: 'x' }, { role: 'user' }, null], 'Q');
    expect(u).toBe('Q'); // nothing valid → just the question
  });
});

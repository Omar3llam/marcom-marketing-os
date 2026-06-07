// ============================================================
// MARCOM Demo — Demo data  (Phase 1: numeric substrate)
// ============================================================
// Realistic MENA media-buyer fixture data for the sales demo.
// Three workspaces selectable via Tweaks; default is Cairo apparel.
//
// SUBSTRATE RULES (Phase 1):
//   • Money is stored as INTEGER minor units (piastres/halalas/fils)
//     plus an ISO 4217 `currency` code — never a pre-formatted string.
//     Formatting happens at the presentation layer via formatCurrency()
//     / formatCurrencyCompact() / formatBleed() in primitives.jsx.
//   • Ratios (roas, ctr, frequency, cpaDelta) stay as plain numbers.
//   • A normalized entity graph (Account → Campaign → AdSet → Ad →
//     Creative) lives under GRAPH; spend/revenue rolls up via rollup().
//   • Narrative copy (radar detail / historical_insight, session impact)
//     is illustrative AI text, not a stored metric.
//
// Field conventions:
//   Money (minor units)   → *Minor (spendMinor, cpaMinor, bleedDailyMinor…)
//   Ratios (numbers)      → roas, ctr, ctrPrev, frequency, cpaDelta
//   API-aligned (radar)   → action_id, analysis{verdict,root_cause},
//                           historical_insight, action_plan, metrics, memory

const DEMO_WORKSPACES = {
  apparel: {
    id: 'apparel',
    name: 'Maison Salam',
    tag: 'Cairo · Modest fashion',
    initials: 'MS',
    user: { name: 'Omar', initials: 'O' },
    market: 'Egypt',
    currency: 'EGP',
    spendMonthlyMinor: 24000000, // EGP 240,000 / mo
    healthScore: 72,
    benchmarks: { avgCpaMinor: 24800 }, // EGP 248
    channels: ['Meta', 'TikTok', 'Google'],
    sessions: [
      { id: 'sess-04', label: 'Eid drop — Carousel ME', verdict: 'KILL', impact: 'EGP 4,200/wk saved', ts: '2h ago', delta: '+12%' },
      { id: 'sess-03', label: 'PMax — Retargeting Warm', verdict: 'SCALE', impact: '+EGP 18k/mo proj', ts: 'Yesterday', delta: '+24%' },
      { id: 'sess-02', label: 'Reels TOFU — LAL 2%', verdict: 'HOLD', impact: '3-day re-scan', ts: '2 days ago', delta: '—' },
      { id: 'sess-01', label: 'Q1 Spring — Static Broad', verdict: 'KILL', impact: 'EGP 6,800/wk saved', ts: '4 days ago', delta: '+18%' },
    ],
  },
  riyadh: {
    id: 'riyadh',
    name: 'Layla & Co.',
    tag: 'Riyadh · Beauty DTC',
    initials: 'LC',
    user: { name: 'Layla', initials: 'L' },
    market: 'Saudi Arabia',
    currency: 'SAR',
    spendMonthlyMinor: 38000000, // SAR 380,000 / mo
    healthScore: 68,
    benchmarks: { avgCpaMinor: 19500 }, // SAR 195
    channels: ['Meta', 'Snap', 'TikTok'],
    sessions: [
      { id: 'sess-r4', label: 'Snap — Influencer push', verdict: 'SCALE', impact: '+SAR 32k/mo proj', ts: '1h ago', delta: '+31%' },
      { id: 'sess-r3', label: 'Meta UGC Reels', verdict: 'HOLD', impact: 'CTR fragile', ts: 'Yesterday', delta: '—' },
      { id: 'sess-r2', label: 'Static — Cold ME', verdict: 'KILL', impact: 'SAR 5,200/wk saved', ts: '3 days ago', delta: '+9%' },
    ],
  },
  dubai: {
    id: 'dubai',
    name: 'Forge Studio',
    tag: 'Dubai · B2B SaaS',
    initials: 'FS',
    user: { name: 'Faris', initials: 'F' },
    market: 'UAE',
    currency: 'AED',
    spendMonthlyMinor: 12000000, // AED 120,000 / mo
    healthScore: 81,
    benchmarks: { avgCpaMinor: 31200 }, // AED 312
    channels: ['Meta', 'LinkedIn', 'Google'],
    sessions: [
      { id: 'sess-d3', label: 'LinkedIn — CTO ICP', verdict: 'SCALE', impact: '+AED 9.4k/mo proj', ts: '5h ago', delta: '+17%' },
      { id: 'sess-d2', label: 'Meta Lead Form — Broad', verdict: 'KILL', impact: 'AED 2,100/wk saved', ts: 'Yesterday', delta: '+11%' },
    ],
  },
};

// ── The featured campaign that the demo flow analyzes ────────
// (Used by InputView → Theatre → SuccessView. KILL verdict.)
const FEATURED_CAMPAIGN = {
  apparel: {
    file: 'maison-salam-meta-may19.csv',
    fileSize: '142 KB',
    rows: 312,
    dateRange: 'Apr 19 – May 19, 2026',
    campaign: {
      name: 'Eid Drop · Carousel · Cold ME',
      objective: 'Conversions — Purchase',
      stage: 'DYING',
      audience: 'Cold ME — 18-44, female',
      adset: 'Carousel · 5 SKUs',
      daysRun: 14,
      // Money — minor units
      spendMinor:     8431000, // EGP 84,310
      cpaMinor:       31200,   // EGP 312
      cpaTargetMinor: 18000,   // EGP 180
      // Ratios — plain numbers
      cpaDelta:   0.73,
      roas:       0.6,
      roasTarget: 2.4,
      ctr:        0.0084,
      ctrPrev:    0.0132,
      frequency:  4.2,
      // Verdict outcome
      verdict: 'KILL',
      confidence: 92,
      financialImpact: { savedWeeklyMinor: 420000, cadence: 'per week', sub: 'saved by killing now' }, // EGP 4,200
      monthlyRecoveredMinor: 1820000, // EGP 18,200 / mo recovered
      title: 'Stop the bleed. Reallocate to PMax warm.',
      reasoning: [
        { tag: 'CPA', body: 'CPA at EGP 312 — 73% above your EGP 180 target. Deteriorating 7 days running.' },
        { tag: 'FREQUENCY', body: 'Frequency 4.2 on cold audience. Past your fatigue threshold (3.5).' },
        { tag: 'CTR', body: 'CTR collapsed 36% in 48h (1.32% → 0.84%). Creative is burned.' },
        { tag: 'MEMORY', body: 'Three Eid cold-audience launches this year hit fatigue by day 14. This matches.' },
      ],
      action: {
        title: 'Kill ad set, reallocate budget',
        verb: 'Pause',
        target: 'Meta · Ad Set #4218990',
        budgetMoveDailyMinor: 60000, // EGP 600/day
        budgetMoveTarget: 'PMax Retargeting Warm',
        confidence: 'High (92%)',
        evidence: '14 days · 312 conversions · 3 prior matches in memory',
      },
    },
  },
  riyadh: {
    file: 'layla-co-snap-may19.csv',
    fileSize: '88 KB',
    rows: 184,
    dateRange: 'Apr 25 – May 19, 2026',
    campaign: {
      name: 'Static · Cold ME · Beauty Bundle',
      objective: 'Conversions — Purchase',
      stage: 'DYING',
      audience: 'Cold ME — 22-38, female',
      adset: 'Static · 3 creatives',
      daysRun: 11,
      spendMinor:     5240000, // SAR 52,400
      cpaMinor:       29800,   // SAR 298
      cpaTargetMinor: 19500,   // SAR 195
      cpaDelta:   0.53,
      roas:       0.9,
      roasTarget: 2.2,
      ctr:        0.0071,
      ctrPrev:    0.0118,
      frequency:  3.9,
      verdict: 'KILL',
      confidence: 89,
      financialImpact: { savedWeeklyMinor: 520000, cadence: 'per week', sub: 'saved by killing now' }, // SAR 5,200
      monthlyRecoveredMinor: 2250000, // SAR 22,500 / mo recovered
      title: 'Static is burned. Move spend to Snap influencer.',
      reasoning: [
        { tag: 'CPA', body: 'CPA at SAR 298 — 53% above your SAR 195 target. Trending up 5 days.' },
        { tag: 'FREQUENCY', body: 'Frequency 3.9 on cold. KSA market saturation hits faster — past threshold.' },
        { tag: 'CTR', body: 'CTR fell 40% in 4 days. Static fatigue is faster than UGC.' },
        { tag: 'MEMORY', body: 'Snap influencer push from last week is scaling at SAR 64 CPA. Reallocate.' },
      ],
      action: {
        title: 'Pause ad set, reallocate to Snap',
        verb: 'Pause',
        target: 'Meta · Ad Set #8821110',
        budgetMoveDailyMinor: 70000, // SAR 700/day
        budgetMoveTarget: 'Snap Influencer push',
        confidence: 'High (89%)',
        evidence: '11 days · 176 conversions · 2 prior matches in memory',
      },
    },
  },
  dubai: {
    file: 'forge-meta-may19.csv',
    fileSize: '64 KB',
    rows: 96,
    dateRange: 'Apr 28 – May 19, 2026',
    campaign: {
      name: 'Meta Lead Form · Broad · CTO',
      objective: 'Lead generation',
      stage: 'FATIGUED',
      audience: 'Broad — UAE Founders/CTO',
      adset: 'Lead Form · 2 variants',
      daysRun: 9,
      spendMinor:     1890000, // AED 18,900
      cpaMinor:       41200,   // AED 412
      cpaTargetMinor: 24000,   // AED 240
      cpaDelta:   0.72,
      roas:       null,
      roasTarget: null,
      ctr:        0.0062,
      ctrPrev:    0.0094,
      frequency:  3.7,
      verdict: 'KILL',
      confidence: 87,
      financialImpact: { savedWeeklyMinor: 210000, cadence: 'per week', sub: 'saved by killing now' }, // AED 2,100
      monthlyRecoveredMinor: 920000, // AED 9,200 / mo recovered
      title: 'Broad is leaking. Push LinkedIn CTO ICP.',
      reasoning: [
        { tag: 'CPL', body: 'CPL at AED 412 — 72% above target. B2B should never break ratio.' },
        { tag: 'FREQUENCY', body: 'Frequency 3.7 on a niche broad. Audience exhausted in 9 days.' },
        { tag: 'CTR', body: 'CTR fell 34% in 6 days. Hook is not landing on CTOs.' },
        { tag: 'MEMORY', body: 'LinkedIn CTO ICP scaling at AED 168 CPL. 2.5× cheaper. Move budget.' },
      ],
      action: {
        title: 'Pause ad set, push LinkedIn',
        verb: 'Pause',
        target: 'Meta · Ad Set #5510042',
        budgetMoveDailyMinor: 30000, // AED 300/day
        budgetMoveTarget: 'LinkedIn CTO ICP',
        confidence: 'High (87%)',
        evidence: '9 days · 46 leads · 1 prior match in memory',
      },
    },
  },
};

// ── Active radar alerts (Command Hub) ────────────────────────
// Each item carries both demo-friendly flat fields AND API-aligned nested fields.
// Bleed is numeric minor units: bleedDailyMinor (per-day) + bleedWeeklyMinor.
const RADAR_ALERTS_BY_WS = {
  apparel: [
    {
      action_id: 'r1',
      analysis: { verdict: 'KILL', root_cause: 'CPA breach' },
      historical_insight: 'CPA EGP 312 (target 180) · 7 days deteriorating',
      action_plan: { action: 'Investigate: CPA breach', status: 'PENDING' },
      metrics: [],
      memory: [],
      id: 'r1',
      priority: 'HIGH',
      campaign: 'Eid Drop · Carousel · Cold ME',
      adset: 'Carousel · 5 SKUs',
      signal: 'CPA breach',
      detail: 'CPA EGP 312 (target 180) · 7 days deteriorating',
      stage: 'DYING',
      time: '2m ago',
      bleedDailyMinor: 60000,   // EGP 600/day
      bleedWeeklyMinor: 420000, // EGP 4,200/wk
      verdict: 'KILL',
    },
    {
      action_id: 'r2',
      analysis: { verdict: 'HOLD', root_cause: 'CTR collapse' },
      historical_insight: 'CTR down 38% in 48h — creative fatigue',
      action_plan: { action: 'Investigate: CTR collapse', status: 'PENDING' },
      metrics: [],
      memory: [],
      id: 'r2',
      priority: 'HIGH',
      campaign: 'Reels TOFU · LAL 2%',
      adset: 'UGC · 3 hooks',
      signal: 'CTR collapse',
      detail: 'CTR down 38% in 48h — creative fatigue',
      stage: 'FATIGUED',
      time: '14m ago',
      bleedDailyMinor: 28000,   // EGP 280/day
      bleedWeeklyMinor: 196000, // EGP 1,960/wk
      verdict: 'HOLD',
    },
    {
      action_id: 'r3',
      analysis: { verdict: 'HOLD', root_cause: 'Audience stale' },
      historical_insight: 'No new conversions from 41% of segment · 14 days',
      action_plan: { action: 'Investigate: Audience stale', status: 'PENDING' },
      metrics: [],
      memory: [],
      id: 'r3',
      priority: 'MEDIUM',
      campaign: 'PMax · Retargeting Warm',
      adset: 'Dynamic · auto',
      signal: 'Audience stale',
      detail: 'No new conversions from 41% of segment · 14 days',
      stage: 'STABLE',
      time: '1h ago',
      bleedDailyMinor: null,
      bleedWeeklyMinor: null,
      verdict: 'HOLD',
    },
    {
      action_id: 'r4',
      analysis: { verdict: 'SCALE', root_cause: 'New scaling opp' },
      historical_insight: 'ROAS 4.8x, CPA stable for 6 days — ready to scale 2x',
      action_plan: { action: 'Investigate: New scaling opp', status: 'PENDING' },
      metrics: [],
      memory: [],
      id: 'r4',
      priority: 'LOW',
      campaign: 'Influencer · Layla',
      adset: 'UGC · single',
      signal: 'New scaling opp',
      detail: 'ROAS 4.8x, CPA stable for 6 days — ready to scale 2x',
      stage: 'SCALING',
      time: '3h ago',
      bleedDailyMinor: null,
      bleedWeeklyMinor: null,
      verdict: 'SCALE',
    },
  ],
  riyadh: [
    {
      action_id: 'r1',
      analysis: { verdict: 'KILL', root_cause: 'CPA breach' },
      historical_insight: 'CPA SAR 298 (target 195) · 5 days deteriorating',
      action_plan: { action: 'Investigate: CPA breach', status: 'PENDING' },
      metrics: [],
      memory: [],
      id: 'r1',
      priority: 'HIGH',
      campaign: 'Static · Cold ME · Beauty Bundle',
      adset: 'Static · 3 creatives',
      signal: 'CPA breach',
      detail: 'CPA SAR 298 (target 195) · 5 days deteriorating',
      stage: 'DYING',
      time: '4m ago',
      bleedDailyMinor: 70000,   // SAR 700/day
      bleedWeeklyMinor: 490000, // SAR 4,900/wk
      verdict: 'KILL',
    },
    {
      action_id: 'r2',
      analysis: { verdict: 'HOLD', root_cause: 'Mixed signal' },
      historical_insight: 'CPA stable but ROAS flatlining at 2.0x',
      action_plan: { action: 'Investigate: Mixed signal', status: 'PENDING' },
      metrics: [],
      memory: [],
      id: 'r2',
      priority: 'MEDIUM',
      campaign: 'Meta UGC Reels',
      adset: 'UGC · 4 creators',
      signal: 'Mixed signal',
      detail: 'CPA stable but ROAS flatlining at 2.0x',
      stage: 'STABLE',
      time: '32m ago',
      bleedDailyMinor: null,
      bleedWeeklyMinor: null,
      verdict: 'HOLD',
    },
    {
      action_id: 'r3',
      analysis: { verdict: 'SCALE', root_cause: 'Scaling green light' },
      historical_insight: 'CPA stable SAR 64 · 6 days · ready for 2x lift',
      action_plan: { action: 'Investigate: Scaling green light', status: 'PENDING' },
      metrics: [],
      memory: [],
      id: 'r3',
      priority: 'LOW',
      campaign: 'Snap · Influencer push',
      adset: 'UGC · single',
      signal: 'Scaling green light',
      detail: 'CPA stable SAR 64 · 6 days · ready for 2x lift',
      stage: 'SCALING',
      time: '2h ago',
      bleedDailyMinor: null,
      bleedWeeklyMinor: null,
      verdict: 'SCALE',
    },
  ],
  dubai: [
    {
      action_id: 'r1',
      analysis: { verdict: 'KILL', root_cause: 'CPL breach' },
      historical_insight: 'CPL AED 412 (target 240) · 6 days trending up',
      action_plan: { action: 'Investigate: CPL breach', status: 'PENDING' },
      metrics: [],
      memory: [],
      id: 'r1',
      priority: 'HIGH',
      campaign: 'Meta Lead Form · Broad · CTO',
      adset: 'Lead Form · 2 variants',
      signal: 'CPL breach',
      detail: 'CPL AED 412 (target 240) · 6 days trending up',
      stage: 'FATIGUED',
      time: '8m ago',
      bleedDailyMinor: 30000,   // AED 300/day
      bleedWeeklyMinor: 210000, // AED 2,100/wk
      verdict: 'KILL',
    },
    {
      action_id: 'r2',
      analysis: { verdict: 'SCALE', root_cause: 'Scaling opp' },
      historical_insight: 'CPL AED 168, stable 8 days — ready to 1.5x',
      action_plan: { action: 'Investigate: Scaling opp', status: 'PENDING' },
      metrics: [],
      memory: [],
      id: 'r2',
      priority: 'MEDIUM',
      campaign: 'LinkedIn · CTO ICP',
      adset: 'Sponsored content',
      signal: 'Scaling opp',
      detail: 'CPL AED 168, stable 8 days — ready to 1.5x',
      stage: 'SCALING',
      time: '1h ago',
      bleedDailyMinor: null,
      bleedWeeklyMinor: null,
      verdict: 'SCALE',
    },
  ],
};

// ── Normalized entity graph (Account → Campaign → AdSet → Ad → Creative) ──
// Leaf creatives carry numeric minor-unit spend/revenue. Parent totals are
// NOT stored — they are derived with rollup() from primitives.jsx, proving
// spend/revenue rolls up creative → ad → ad set → campaign → account.
const ENTITY_GRAPH = {
  apparel: {
    level: 'ACCOUNT', id: 'acct-apparel', name: 'Maison Salam · Meta', channel: 'META', currency: 'EGP',
    children: [
      {
        level: 'CAMPAIGN', id: 'camp-apparel-eid', name: 'Eid Drop · Carousel · Cold ME', channel: 'META',
        children: [
          {
            level: 'ADSET', id: 'adset-4218990', name: 'Carousel · 5 SKUs', channel: 'META',
            children: [
              { level: 'AD', id: 'ad-apparel-a', name: 'Carousel A', channel: 'META', children: [
                { level: 'CREATIVE', id: 'cr-apparel-a', name: 'Eid Hero 01', channel: 'META', spendMinor: 5000000, revenueMinor: 3000000 },
              ] },
              { level: 'AD', id: 'ad-apparel-b', name: 'Carousel B', channel: 'META', children: [
                { level: 'CREATIVE', id: 'cr-apparel-b', name: 'Eid Hero 02', channel: 'META', spendMinor: 3431000, revenueMinor: 2058600 },
              ] },
            ],
          },
        ],
      },
    ],
  },
  riyadh: {
    level: 'ACCOUNT', id: 'acct-riyadh', name: 'Layla & Co. · Snap', channel: 'SNAP', currency: 'SAR',
    children: [
      {
        level: 'CAMPAIGN', id: 'camp-riyadh-static', name: 'Static · Cold ME · Beauty Bundle', channel: 'SNAP',
        children: [
          {
            level: 'ADSET', id: 'adset-8821110', name: 'Static · 3 creatives', channel: 'SNAP',
            children: [
              { level: 'AD', id: 'ad-riyadh-a', name: 'Static A', channel: 'SNAP', children: [
                { level: 'CREATIVE', id: 'cr-riyadh-a', name: 'Bundle Still 01', channel: 'SNAP', spendMinor: 3000000, revenueMinor: 2700000 },
              ] },
              { level: 'AD', id: 'ad-riyadh-b', name: 'Static B', channel: 'SNAP', children: [
                { level: 'CREATIVE', id: 'cr-riyadh-b', name: 'Bundle Still 02', channel: 'SNAP', spendMinor: 2240000, revenueMinor: 2016000 },
              ] },
            ],
          },
        ],
      },
    ],
  },
  dubai: {
    level: 'ACCOUNT', id: 'acct-dubai', name: 'Forge Studio · Meta', channel: 'LINKEDIN', currency: 'AED',
    children: [
      {
        level: 'CAMPAIGN', id: 'camp-dubai-lead', name: 'Meta Lead Form · Broad · CTO', channel: 'LINKEDIN',
        children: [
          {
            level: 'ADSET', id: 'adset-5510042', name: 'Lead Form · 2 variants', channel: 'LINKEDIN',
            children: [
              { level: 'AD', id: 'ad-dubai-a', name: 'Lead Form A', channel: 'LINKEDIN', children: [
                { level: 'CREATIVE', id: 'cr-dubai-a', name: 'CTO Hook 01', channel: 'LINKEDIN', spendMinor: 1000000, revenueMinor: 0 },
              ] },
              { level: 'AD', id: 'ad-dubai-b', name: 'Lead Form B', channel: 'LINKEDIN', children: [
                { level: 'CREATIVE', id: 'cr-dubai-b', name: 'CTO Hook 02', channel: 'LINKEDIN', spendMinor: 890000, revenueMinor: 0 },
              ] },
            ],
          },
        ],
      },
    ],
  },
};

// ── Live activity ticker rows (Command Hub) ──────────────────
const ACTIVITY_TICKER = [
  { t: '0:02', body: 'Radar scanning 14 ad sets · 312 row delta',  type: 'scan'    },
  { t: '0:09', body: 'CPA breach detected · Eid Carousel',         type: 'alert'   },
  { t: '0:14', body: 'Cross-referenced 3 prior decisions in memory', type: 'memory' },
  { t: '0:17', body: 'Verdict locked · KILL · 92% confidence',     type: 'verdict' },
];

// ── Theatre vectors — what the AI "scans" ────────────────────
// {currency} is replaced at render time with workspace.currency
const SCAN_VECTORS = [
  { id: 1,  label: 'CPA trajectory',          unit: 'last 14d' },
  { id: 2,  label: 'Frequency saturation',    unit: 'cold audience' },
  { id: 3,  label: 'CTR decay slope',         unit: '48h window' },
  { id: 4,  label: 'Creative fatigue signal', unit: 'engagement Δ' },
  { id: 5,  label: 'Audience overlap',        unit: 'vs warm pool' },
  { id: 6,  label: 'Budget velocity',         unit: '{currency}/day' },
  { id: 7,  label: 'Time-of-day pacing',      unit: 'last 168h' },
  { id: 8,  label: 'Geo concentration',       unit: '12 markets' },
  { id: 9,  label: 'Placement breakdown',     unit: 'Reels / Feed / Stories' },
  { id: 10, label: 'Memory: prior outcomes',  unit: '3 matches found' },
  { id: 11, label: 'Market dialect signal',   unit: 'MENA cold launches' },
  { id: 12, label: 'Financial counterfactual', unit: 'reallocation paths' },
  { id: 13, label: 'Risk envelope',           unit: 'σ confidence' },
  { id: 14, label: 'Verdict locked',          unit: 'KILL · 92%' },
];

// ── Execution steps (after user confirms) ────────────────────
const EXECUTION_STEPS = [
  { id: 1, label: 'Verify ownership · workspace token',     sub: 'Firebase JWT · 200 OK' },
  { id: 2, label: 'Idempotency lock · ad set #4218990',     sub: 'BullMQ · queue marcom-execute' },
  { id: 3, label: 'Meta Graph API · update_status',         sub: 'POST /act_98441/adsets · PAUSED' },
  { id: 4, label: 'Reallocate budget · EGP 600/day',        sub: 'PMax warm · ad set #4099120' },
  { id: 5, label: 'Audit log · DecisionMemory.write',       sub: 'Postgres · row 14821 committed' },
  { id: 6, label: 'Notify · workspace #maison-salam',       sub: 'WebSocket · 1 listener' },
];

// ── Phase 2: multi-level verdict drill-down (keyed by alert id) ──
// Each alert can expand to a campaign → ad-set → creative tree where
// EVERY level carries its own verdict — and a campaign can be SCALE
// while a child ad set is KILL (see apparel r3 below).
const DRILLDOWN_BY_WS = {
  apparel: {
    r1: {
      campaign: { name: 'Eid Drop · Carousel · Cold ME', verdict: 'KILL', rationale: 'ROAS 0.6 below break-even with frequency 4.2 past the 3.5 ceiling.' },
      adsets: [
        {
          id: 'adset-4218990', name: 'Carousel · 5 SKUs', verdict: 'KILL', rationale: 'CPA EGP 312 — 73% over target, deteriorating 7 days.',
          creatives: [
            { name: 'Eid Hero 01', verdict: 'KILL',    rationale: 'CTR collapsed 36% in 48h — burned.' },
            { name: 'Eid Hero 02', verdict: 'REFRESH', rationale: 'Still profitable but fatiguing — swap the hook.' },
          ],
        },
      ],
    },
    // Headline example: a SCALE campaign that contains a KILL ad set.
    r3: {
      campaign: { name: 'PMax · Retargeting Warm', verdict: 'SCALE', rationale: 'Net ROAS 3.1 — strong enough to scale despite one leaking ad set.' },
      adsets: [
        {
          id: 'adset-pmax-dyn', name: 'Dynamic · auto', verdict: 'SCALE', rationale: 'ROAS 4.8, CPA stable 6 days — ready to lift 2×.',
          creatives: [{ name: 'Dynamic feed', verdict: 'SCALE', rationale: 'Top performer — duplicate the winner.' }],
        },
        {
          id: 'adset-pmax-lal', name: 'Warm LAL 2%', verdict: 'KILL', rationale: 'No new conversions from 41% of segment for 14 days.',
          creatives: [{ name: 'LAL static', verdict: 'KILL', rationale: 'Audience exhausted — stop the bleed.' }],
        },
      ],
    },
  },
  riyadh: {
    r1: {
      campaign: { name: 'Static · Cold ME · Beauty Bundle', verdict: 'KILL', rationale: 'ROAS 0.9 below break-even, frequency past ceiling.' },
      adsets: [
        {
          id: 'adset-8821110', name: 'Static · 3 creatives', verdict: 'KILL', rationale: 'CPA SAR 298 — 53% over target.',
          creatives: [
            { name: 'Bundle Still 01', verdict: 'KILL',    rationale: 'CTR fell 40% in 4 days.' },
            { name: 'Bundle Still 02', verdict: 'REALLOCATE', rationale: 'Move spend to the Snap influencer push.' },
          ],
        },
      ],
    },
  },
  dubai: {
    r1: {
      campaign: { name: 'Meta Lead Form · Broad · CTO', verdict: 'KILL', rationale: 'CPL AED 412 — 72% over target, trending up.' },
      adsets: [
        {
          id: 'adset-5510042', name: 'Lead Form · 2 variants', verdict: 'REALLOCATE', rationale: 'Reallocate budget to LinkedIn CTO ICP (2.5× cheaper).',
          creatives: [
            { name: 'CTO Hook 01', verdict: 'REFRESH', rationale: 'Hook not landing on CTOs — refresh.' },
            { name: 'CTO Hook 02', verdict: 'KILL',    rationale: 'No leads in 6 days.' },
          ],
        },
      ],
    },
  },
};

// ── Phase 2: forward-looking fatigue predictions (keyed by alert id) ──
const FATIGUE_BY_WS = {
  apparel: {
    r2: { willBreach: true, metric: 'frequency', ceiling: 3.5, daysToBreach: 3, projectedBreachDate: 'May 22', confidence: 0.86, note: 'Reels UGC · 3 hooks projected to breach frequency 3.5 in ~3 days' },
  },
  riyadh: {
    r2: { willBreach: true, metric: 'frequency', ceiling: 3.5, daysToBreach: 4, projectedBreachDate: 'May 23', confidence: 0.79, note: 'Meta UGC Reels projected to breach frequency 3.5 in ~4 days' },
  },
  dubai: {},
};

// ── Phase 2: user-defined guardrail rules + their radar hits ──────
// Rules run every sweep; hits become PROPOSED radar verdicts the human
// confirms — never silent auto-execution.
const GUARDRAILS_BY_WS = {
  apparel: {
    rules: [
      { id: 'g1', name: 'Cold CPA breach', scopeLevel: 'ADSET', audienceTag: 'cold', metric: 'cpaOverTargetPct', comparator: 'GTE', threshold: 50, unit: 'PCT', sustainedDays: 2, emitVerdict: 'KILL', enabled: true },
      { id: 'g2', name: 'ROAS floor', scopeLevel: 'ADSET', metric: 'roas', comparator: 'LT', threshold: 1, unit: 'RATIO', sustainedDays: 1, emitVerdict: 'WATCH', enabled: true },
      { id: 'g3', name: 'Frequency ceiling (cold)', scopeLevel: 'ADSET', audienceTag: 'cold', metric: 'frequency', comparator: 'GTE', threshold: 3.5, unit: 'RATIO', sustainedDays: 1, emitVerdict: 'REFRESH', enabled: false },
    ],
    hits: [
      { ruleId: 'g1', ruleName: 'Cold CPA breach', entity: 'Carousel · 5 SKUs', verdict: 'KILL', rationale: 'CPA ≥ +50% over target for 2 days', status: 'PROPOSED' },
    ],
  },
  riyadh: {
    rules: [
      { id: 'g1', name: 'Cold CPA breach', scopeLevel: 'ADSET', audienceTag: 'cold', metric: 'cpaOverTargetPct', comparator: 'GTE', threshold: 50, unit: 'PCT', sustainedDays: 2, emitVerdict: 'KILL', enabled: true },
    ],
    hits: [
      { ruleId: 'g1', ruleName: 'Cold CPA breach', entity: 'Static · 3 creatives', verdict: 'KILL', rationale: 'CPA ≥ +50% over target for 2 days', status: 'PROPOSED' },
    ],
  },
  dubai: {
    rules: [
      { id: 'g1', name: 'B2B CPL ceiling', scopeLevel: 'ADSET', metric: 'cpaOverTargetPct', comparator: 'GTE', threshold: 60, unit: 'PCT', sustainedDays: 2, emitVerdict: 'REALLOCATE', enabled: true },
    ],
    hits: [],
  },
};

// ── Phase 3: portfolio + blended truth + capital allocation ───────
// All money is integer minor units. Each channel carries the platform
// CLAIM and (where a GA4/Shopify connector exists) the ACTUAL — the
// blended truth allocation keys off the actual, flagging UNVERIFIED
// channels. Pacing answers "Meta exhausts budget N days early".
const PORTFOLIO_BY_WS = {
  apparel: {
    currency: 'EGP',
    monthlyBudgetMinor: 15000000, // EGP 150,000 ceiling
    totals: {
      spendMinor: 12431000, platformRevenueMinor: 14658600, blendedRevenueMinor: 13400000,
      platformRoas: 1.18, blendedRoas: 1.08, gapPct: 0.086, reconciledCount: 1, unverifiedCount: 1,
    },
    channels: [
      {
        channelId: 'acct-meta', channel: 'Meta', currency: 'EGP',
        spendMinor: 8431000, platformRevenueMinor: 5058600, actualRevenueMinor: 3800000,
        blendedRevenueMinor: 3800000, gapPct: 0.249, platformRoas: 0.60, blendedRoas: 0.45,
        coverage: 'RECONCILED', confidence: 'HIGH',
        pacing: { status: 'OVER', daysEarly: 6, projectedSpendMinor: 10100000 },
      },
      {
        channelId: 'acct-google', channel: 'Google', currency: 'EGP',
        spendMinor: 4000000, platformRevenueMinor: 9600000, actualRevenueMinor: null,
        blendedRevenueMinor: 9600000, gapPct: 0, platformRoas: 2.40, blendedRoas: 2.40,
        coverage: 'UNVERIFIED', confidence: 'LOW',
        pacing: { status: 'UNDER', daysEarly: -4, projectedSpendMinor: 4600000 },
      },
    ],
    // Scenario preview for the budget+goal recommender.
    allocation: {
      goal: { type: 'GROWTH_CEILING', value: null },
      totalBudgetMinor: 15000000, currency: 'EGP',
      allocations: [
        { channelId: 'acct-google', channel: 'Google', verdict: 'SCALE', currentSpendMinor: 4000000, recommendedSpendMinor: 9000000, deltaMinor: 5000000, blendedRoas: 2.40, rationale: 'Grow Google by 5,000,000 (SCALE, blended ROAS 2.40x) — strongest marginal return.' },
        { channelId: 'acct-meta', channel: 'Meta', verdict: 'REALLOCATE', currentSpendMinor: 8431000, recommendedSpendMinor: 6000000, deltaMinor: -2431000, blendedRoas: 0.45, rationale: 'Trim Meta by 2,431,000 (REALLOCATE, blended ROAS 0.45x) — GA4 shows ~25% over-report, below break-even.' },
      ],
      projected: { blendedRevenueMinor: 24300000, projectedCpaMinor: 41000, merBefore: 1.08, merAfter: 1.62 },
      reasoningTrail: [
        'Goal GROWTH_CEILING: distribute 150,000 EGP toward marginal efficiency; projected blended ROAS 1.08x → 1.62x.',
        'Grow Google (blended ROAS 2.40x) — strongest marginal return.',
        'Trim Meta: GA4 actual shows ~25% revenue over-report; blended ROAS 0.45x, below break-even.',
      ],
    },
  },
  riyadh: {
    currency: 'SAR',
    monthlyBudgetMinor: 38000000,
    totals: {
      spendMinor: 21000000, platformRevenueMinor: 58000000, blendedRevenueMinor: 49000000,
      platformRoas: 2.76, blendedRoas: 2.33, gapPct: 0.155, reconciledCount: 1, unverifiedCount: 1,
    },
    channels: [
      {
        channelId: 'acct-snap', channel: 'Snap', currency: 'SAR',
        spendMinor: 13000000, platformRevenueMinor: 39000000, actualRevenueMinor: 31000000,
        blendedRevenueMinor: 31000000, gapPct: 0.205, platformRoas: 3.00, blendedRoas: 2.38,
        coverage: 'RECONCILED', confidence: 'HIGH',
        pacing: { status: 'OVER', daysEarly: 3, projectedSpendMinor: 15000000 },
      },
      {
        channelId: 'acct-meta', channel: 'Meta', currency: 'SAR',
        spendMinor: 8000000, platformRevenueMinor: 19000000, actualRevenueMinor: null,
        blendedRevenueMinor: 19000000, gapPct: 0, platformRoas: 2.38, blendedRoas: 2.38,
        coverage: 'UNVERIFIED', confidence: 'LOW',
        pacing: { status: 'ON_TRACK', daysEarly: 0, projectedSpendMinor: 16000000 },
      },
    ],
    allocation: {
      goal: { type: 'GROWTH_CEILING', value: null },
      totalBudgetMinor: 38000000, currency: 'SAR',
      allocations: [
        { channelId: 'acct-snap', channel: 'Snap', verdict: 'SCALE', currentSpendMinor: 13000000, recommendedSpendMinor: 22000000, deltaMinor: 9000000, blendedRoas: 2.38, rationale: 'Grow Snap by 9,000,000 (SCALE, blended ROAS 2.38x).' },
        { channelId: 'acct-meta', channel: 'Meta', verdict: 'HOLD', currentSpendMinor: 8000000, recommendedSpendMinor: 16000000, deltaMinor: 8000000, blendedRoas: 2.38, rationale: 'Grow Meta by 8,000,000 (HOLD, blended ROAS 2.38x — unverified, pending GA4).' },
      ],
      projected: { blendedRevenueMinor: 90400000, projectedCpaMinor: 18000, merBefore: 2.33, merAfter: 2.38 },
      reasoningTrail: [
        'Goal GROWTH_CEILING: distribute 380,000 SAR toward marginal efficiency; projected blended ROAS 2.33x → 2.38x.',
        'Snap reconciles via Shopify — grow it first.',
        'Meta is unverified (no connector yet) — grow cautiously, flag low-confidence.',
      ],
    },
  },
  dubai: {
    currency: 'AED',
    monthlyBudgetMinor: 12000000,
    totals: {
      spendMinor: 6800000, platformRevenueMinor: 14000000, blendedRevenueMinor: 14000000,
      platformRoas: 2.06, blendedRoas: 2.06, gapPct: 0, reconciledCount: 0, unverifiedCount: 2,
    },
    channels: [
      {
        channelId: 'acct-linkedin', channel: 'LinkedIn', currency: 'AED',
        spendMinor: 3800000, platformRevenueMinor: 9800000, actualRevenueMinor: null,
        blendedRevenueMinor: 9800000, gapPct: 0, platformRoas: 2.58, blendedRoas: 2.58,
        coverage: 'UNVERIFIED', confidence: 'LOW',
        pacing: { status: 'OVER', daysEarly: 5, projectedSpendMinor: 4600000 },
      },
      {
        channelId: 'acct-meta', channel: 'Meta', currency: 'AED',
        spendMinor: 3000000, platformRevenueMinor: 4200000, actualRevenueMinor: null,
        blendedRevenueMinor: 4200000, gapPct: 0, platformRoas: 1.40, blendedRoas: 1.40,
        coverage: 'UNVERIFIED', confidence: 'LOW',
        pacing: { status: 'UNDER', daysEarly: -6, projectedSpendMinor: 2400000 },
      },
    ],
    allocation: {
      goal: { type: 'GROWTH_CEILING', value: null },
      totalBudgetMinor: 12000000, currency: 'AED',
      allocations: [
        { channelId: 'acct-linkedin', channel: 'LinkedIn', verdict: 'SCALE', currentSpendMinor: 3800000, recommendedSpendMinor: 8000000, deltaMinor: 4200000, blendedRoas: 2.58, rationale: 'Grow LinkedIn by 4,200,000 (SCALE, blended ROAS 2.58x).' },
        { channelId: 'acct-meta', channel: 'Meta', verdict: 'REALLOCATE', currentSpendMinor: 3000000, recommendedSpendMinor: 4000000, deltaMinor: 1000000, blendedRoas: 1.40, rationale: 'Hold-grow Meta by 1,000,000 (REALLOCATE, blended ROAS 1.40x).' },
      ],
      projected: { blendedRevenueMinor: 26240000, projectedCpaMinor: 28000, merBefore: 2.06, merAfter: 2.19 },
      reasoningTrail: [
        'Goal GROWTH_CEILING: distribute 120,000 AED toward marginal efficiency; projected blended ROAS 2.06x → 2.19x.',
        'No GA4/Shopify connector yet — every channel is UNVERIFIED; numbers rest on platform claims.',
        'LinkedIn carries the best platform ROAS — grow it, but verify before scaling hard.',
      ],
    },
  },
};

// ── Phase 4: Testing OS — weekly agenda + the closed loop ──────
const TESTING_BY_WS = {
  apparel: {
    currency: 'EGP',
    agenda: [
      { entityId: 'adset-carousel', name: 'Carousel · 5 SKUs', dimension: 'HOOK', metric: 'CTR', priority: 2.4,
        hypothesis: 'A sharper first-frame hook will lift CTR on "Carousel · 5 SKUs".',
        expectedSignal: 'CTR rises within 3–4 days at similar or lower CPM.',
        variants: [
          { label: 'A', description: 'Current hook (control)', isControl: true },
          { label: 'B', description: 'Sharper first-frame hook / opening line', isControl: false },
        ] },
      { entityId: 'adset-cold-lal', name: 'Cold · 1% LAL', dimension: 'OFFER', metric: 'ROAS', priority: 1.9,
        hypothesis: 'A stronger offer angle will convert existing traffic into return.',
        expectedSignal: 'ROAS / conversion rate improves while CTR holds.',
        variants: [
          { label: 'A', description: 'Current offer (control)', isControl: true },
          { label: 'B', description: 'Bundle / urgency / discount angle', isControl: false },
        ] },
      { entityId: 'adset-retarget', name: 'Retargeting · 30d', dimension: 'AUDIENCE', metric: 'CPA', priority: 1.5,
        hypothesis: 'A fresher audience will lower CPA by breaking saturation.',
        expectedSignal: 'CPA falls and frequency resets on the new audience.',
        variants: [
          { label: 'A', description: 'Current audience (control)', isControl: true },
          { label: 'B', description: 'Broad / advantage+', isControl: false },
          { label: 'C', description: '1–3% lookalike', isControl: false },
        ] },
    ],
    running: [
      { id: 'audience-running', name: 'Carousel · 5 SKUs', dimension: 'AUDIENCE', metric: 'CPA', status: 'RUNNING',
        hypothesis: 'A fresher audience will lower CPA by breaking saturation.',
        variants: [
          { label: 'A', metricText: 'CPA EGP 40.0', sampleText: '120k impr', isControl: true },
          { label: 'B', metricText: 'CPA EGP 31.9', sampleText: '110k impr', isControl: false },
        ] },
    ],
    concluded: [
      { id: 'hook-concluded', name: 'Carousel · 5 SKUs', dimension: 'HOOK', metric: 'CTR',
        winnerLabel: 'B', lift: 22.2, confidenceLabel: 'MODERATE',
        sampleNote: '60,000 impressions on the smaller arm.',
        verdict: 'REFRESH', memoryWritten: true,
        rationale: 'Hook B beat Hook A by 22.2% CTR (1.83% vs 1.5%), moderate confidence.',
        variants: [
          { label: 'A', metricText: '1.50% CTR', isControl: true,  isWinner: false },
          { label: 'B', metricText: '1.83% CTR', isControl: false, isWinner: true },
        ] },
      { id: 'angle-thin', name: 'Carousel · 5 SKUs', dimension: 'CREATIVE_ANGLE', metric: 'CTR',
        winnerLabel: null, lift: 0, confidenceLabel: 'INCONCLUSIVE',
        sampleNote: 'Only 320 impressions on the smaller arm — too thin to call (need 1000).',
        verdict: null, memoryWritten: true,
        rationale: 'No variant beat the control on CTR at a callable sample — inconclusive.',
        variants: [
          { label: 'A', metricText: '1.47% CTR', isControl: true,  isWinner: false },
          { label: 'B', metricText: '2.19% CTR', isControl: false, isWinner: false },
        ] },
    ],
  },
  riyadh: {
    currency: 'SAR',
    agenda: [
      { entityId: 'adset-snap-broad', name: 'Snap · Broad', dimension: 'CREATIVE_ANGLE', metric: 'CTR', priority: 1.7,
        hypothesis: 'A UGC, problem-led angle will re-engage a plateaued audience.',
        expectedSignal: 'CTR recovers as a new angle resets attention.',
        variants: [
          { label: 'A', description: 'Current angle (control)', isControl: true },
          { label: 'B', description: 'UGC, problem-led re-framing', isControl: false },
        ] },
    ],
    running: [],
    concluded: [
      { id: 'snap-offer', name: 'Snap · Broad', dimension: 'OFFER', metric: 'ROAS',
        winnerLabel: 'B', lift: 48.0, confidenceLabel: 'MODERATE',
        sampleNote: '90 conversions on the smaller arm.',
        verdict: 'SCALE', memoryWritten: true,
        rationale: 'Offer B beat Offer A by 48% ROAS (3.0x vs 2.0x), moderate confidence.',
        variants: [
          { label: 'A', metricText: '2.00× ROAS', isControl: true,  isWinner: false },
          { label: 'B', metricText: '2.96× ROAS', isControl: false, isWinner: true },
        ] },
    ],
  },
  dubai: {
    currency: 'AED',
    agenda: [
      { entityId: 'adset-li', name: 'LinkedIn · ABM', dimension: 'HOOK', metric: 'CTR', priority: 1.4,
        hypothesis: 'A sharper opening line will lift CTR on the ABM set.',
        expectedSignal: 'CTR rises within 3–4 days at similar or lower CPM.',
        variants: [
          { label: 'A', description: 'Current hook (control)', isControl: true },
          { label: 'B', description: 'Sharper opening line', isControl: false },
        ] },
    ],
    running: [],
    concluded: [],
  },
};

export const DEMO_DATA = {
  WORKSPACES: DEMO_WORKSPACES,
  FEATURED:   FEATURED_CAMPAIGN,
  RADAR_BY_WS: RADAR_ALERTS_BY_WS,
  GRAPH:      ENTITY_GRAPH,
  DRILLDOWN_BY_WS: DRILLDOWN_BY_WS,
  FATIGUE_BY_WS:   FATIGUE_BY_WS,
  GUARDRAILS_BY_WS: GUARDRAILS_BY_WS,
  PORTFOLIO_BY_WS:  PORTFOLIO_BY_WS,
  TESTING_BY_WS:    TESTING_BY_WS,
  ACTIVITY:   ACTIVITY_TICKER,
  VECTORS:    SCAN_VECTORS,
  EXECUTION:  EXECUTION_STEPS,
};

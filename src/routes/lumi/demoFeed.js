// ============================================================
// MARCOM / Lumi — Static demo feed (PUBLIC stakeholder preview)
// Extracted from feed.js for route-file size compliance.
// ============================================================

export function demoFeedHandler(_req, res) {
  res.json({
    workspaceId: 'demo-workspace',
    generatedAt: new Date().toISOString(),
    campaigns: [
      // ── DYING / HIGH priority ─────────────────────────────
      {
        campaign_id: 'Summer Promo — Broad Lookalike',
        stage:       'DYING',
        health_score: 0.18,   // illustrative, tracks the DYING metrics below
        alerts: [
          {
            action_id:        'demo-act-001',
            idempotency_key:  'demo-key-001',
            priority:         'HIGH',
            analysis: {
              verdict:    'PAUSE_AND_RELAUNCH',
              root_cause: 'Creative fatigue compounded by audience saturation; CPA has tripled in 7 days while ROAS collapsed below break-even.',
            },
            historical_insight:
              'The last two budget-scale actions on this campaign regressed within 24h. Audience tightening also under-performed.',
            action_plan: {
              action:           'Pause the Broad Lookalike ad set immediately and re-launch with a fresh UGC creative against a 1-3% lookalike seeded from the last 30-day purchaser list.',
              status:           'PENDING',
              imageUrl:         null,
              reference_prompt: 'Reference visual: 9:16 UGC-style hand-held shot, natural lighting, model holding product mid-frame, captions burned-in.',
            },
            metrics: [
              { metric: 'CTR',       trend: 'down', value: '0.42%',  delta: '-58% vs last week',         context: 'Last 48h',                  status: 'danger'  },
              { metric: 'ROAS',      trend: 'down', value: '0.71x',  delta: '-1.4x vs target',           context: '7-day avg',                 status: 'danger'  },
              { metric: 'Frequency', trend: 'up',   value: '8.6',    delta: '+4.1 vs healthy ceiling',   context: 'Lifetime, active audience', status: 'danger'  },
              { metric: 'CPA',       trend: 'up',   value: '$84.20', delta: '+312% vs week 1',           context: 'Last 7 days',               status: 'warning' },
            ],
            memory: [
              { actionType: 'meta.scale_budget',     decisionRationale: 'Doubled daily budget after 3 days of >3x ROAS',  isSustainable: false, impactDurationHrs: 24 },
              { actionType: 'meta.swap_creative',    decisionRationale: 'Replaced static carousel with UGC reel',          isSustainable: true,  impactDurationHrs: 24 },
              { actionType: 'meta.tighten_audience', decisionRationale: 'Narrowed lookalike from 5% to 1%',                isSustainable: false, impactDurationHrs: 24 },
            ],
          },
        ],
      },

      // ── FATIGUED / MEDIUM priority ────────────────────────
      {
        campaign_id: 'Brand Awareness — IG Reels Q2',
        stage:       'FATIGUED',
        health_score: 0.46,   // illustrative, tracks the FATIGUED metrics below
        alerts: [
          {
            action_id:        'demo-act-002',
            idempotency_key:  'demo-key-002',
            priority:         'MEDIUM',
            analysis: {
              verdict:    'REFRESH_CREATIVE',
              root_cause: 'Audience overlap with the hero campaign is suppressing reach; engagement is decaying slowly but recoverable with a creative refresh.',
            },
            historical_insight:
              'Creative refreshes on similar reels lifted CTR by ~18% on average over the last 60 days.',
            action_plan: {
              action:           'Refresh the top-3 fatigued reels with a new hook frame and shift 30% of the budget into a fresh interest-based audience to break the overlap.',
              status:           'PENDING',
              imageUrl:         null,
              reference_prompt: 'Reference visual: bold first-frame text overlay ("Wait — watch this"), product in motion, branded colour wash on transition.',
            },
            metrics: [
              { metric: 'CTR',             trend: 'down', value: '1.18%', delta: '-22% vs last week', context: 'Last 7 days',           status: 'warning' },
              { metric: 'ROAS',            trend: 'down', value: '1.82x', delta: '-0.18x vs target',  context: '7-day avg',             status: 'warning' },
              { metric: 'Engagement Rate', trend: 'flat', value: '3.4%',  delta: '~0% vs last week',  context: 'Reels, last 14 days',   status: 'neutral' },
              { metric: 'Impressions',     trend: 'down', value: '142k',  delta: '-31% vs last week', context: 'Last 7 days',           status: 'warning' },
            ],
            memory: [
              { actionType: 'meta.refresh_creative', decisionRationale: 'Swapped first-frame hook on top reel',          isSustainable: true,  impactDurationHrs: 48 },
              { actionType: 'meta.shift_budget',    decisionRationale: 'Moved 20% spend into interest stack',            isSustainable: null,  impactDurationHrs: null },
            ],
          },
        ],
      },

      // ── STABLE / LOW priority ─────────────────────────────
      {
        campaign_id: 'Brand Search — Always-On',
        stage:       'STABLE',
        health_score: 0.93,   // illustrative, tracks the STABLE metrics below
        alerts: [
          {
            action_id:        'demo-act-003',
            idempotency_key:  'demo-key-003',
            priority:         'LOW',
            analysis: {
              verdict:    'HOUSEKEEPING',
              root_cause: 'Performing within tolerance. Optional housekeeping only.',
            },
            historical_insight: 'No regressions on this campaign in the last 30 days.',
            action_plan: {
              action:           'Add three negative keywords flagged by last week\'s search-term report; no creative or bid change required.',
              status:           'PENDING',
              imageUrl:         null,
              reference_prompt: null,
            },
            metrics: [
              { metric: 'CTR',  trend: 'up',   value: '12.4%', delta: '+0.8% vs last week', context: 'Last 7 days', status: 'positive' },
              { metric: 'ROAS', trend: 'flat', value: '4.6x',  delta: '+0.1x vs target',    context: '7-day avg',   status: 'positive' },
            ],
            memory: [],
          },
        ],
      },
    ],
  });
}

// ============================================================
// MARCOM / Lumi — Mock Feed Data (V1.2)
// ------------------------------------------------------------
// Source of truth for the Decision OS until the live
// GET /api/lumi/feed endpoint is wired up.
//
// V1.2 change:
//   `whyDeepDive` is no longer an array of free-form strings.
//   Each entry is a structured Signal object so the
//   DecisionTheater can render real metric rows (icon, value,
//   delta, status colour) instead of bullet points.
// ============================================================

export const mockFeedData = {
  generatedAt: new Date().toISOString(),
  decisions: [
    // ── Campaign 1 ── DYING / HIGH priority ───────────────────
    {
      id: 'dec_001',
      campaignId: 'fb_summer_promo_24',
      campaignName: 'Summer Promo — Broad Lookalike',
      stage: 'DYING',
      priority: 'HIGH',
      rootCause:
        'Creative fatigue compounded by audience saturation; CPA has tripled in 7 days while ROAS collapsed below break-even.',
      whyDeepDive: [
        {
          metric:  'CTR',
          trend:   'down',
          value:   '0.42%',
          delta:   '-58% vs last week',
          context: 'Last 48h',
          status:  'danger',
        },
        {
          metric:  'ROAS',
          trend:   'down',
          value:   '0.71x',
          delta:   '-1.4x vs target',
          context: '7-day avg',
          status:  'danger',
        },
        {
          metric:  'Frequency',
          trend:   'up',
          value:   '8.6',
          delta:   '+4.1 vs healthy ceiling',
          context: 'Lifetime, active audience',
          status:  'danger',
        },
        {
          metric:  'CPA',
          trend:   'up',
          value:   '$84.20',
          delta:   '+312% vs week 1',
          context: 'Last 7 days',
          status:  'warning',
        },
      ],
      actionPlan: {
        action:
          'Pause the Broad Lookalike ad set immediately and re-launch with a fresh UGC creative against a 1-3% lookalike seeded from the last 30-day purchaser list.',
        imageUrl: null,
        referencePrompt:
          'Reference visual: 9:16 UGC-style hand-held shot, natural lighting, model holding product mid-frame, captions burned-in.',
      },
    },

    // ── Campaign 2 ── FATIGUED / MEDIUM priority ──────────────
    {
      id: 'dec_002',
      campaignId: 'ig_brand_awareness_q2',
      campaignName: 'Brand Awareness — IG Reels Q2',
      stage: 'FATIGUED',
      priority: 'MEDIUM',
      rootCause:
        'Audience overlap with the hero campaign is suppressing reach; engagement is decaying slowly but recoverable with a creative refresh.',
      whyDeepDive: [
        {
          metric:  'CTR',
          trend:   'down',
          value:   '1.18%',
          delta:   '-22% vs last week',
          context: 'Last 7 days',
          status:  'warning',
        },
        {
          metric:  'ROAS',
          trend:   'down',
          value:   '1.82x',
          delta:   '-0.18x vs target',
          context: '7-day avg',
          status:  'warning',
        },
        {
          metric:  'Engagement Rate',
          trend:   'flat',
          value:   '3.4%',
          delta:   '~0% vs last week',
          context: 'Reels, last 14 days',
          status:  'neutral',
        },
        {
          metric:  'Impressions',
          trend:   'down',
          value:   '142k',
          delta:   '-31% vs last week',
          context: 'Last 7 days',
          status:  'warning',
        },
      ],
      actionPlan: {
        action:
          'Refresh the top-3 fatigued reels with a new hook frame and shift 30% of the budget into a fresh interest-based audience to break the overlap.',
        imageUrl: null,
        referencePrompt:
          'Reference visual: bold first-frame text overlay ("Wait — watch this"), product in motion, branded colour wash on transition.',
      },
    },

    // ── Campaign 3 ── STABLE / LOW priority (kept simple) ─────
    {
      id: 'dec_003',
      campaignId: 'g_search_brand_kw',
      campaignName: 'Brand Search — Always-On',
      stage: 'STABLE',
      priority: 'LOW',
      rootCause: 'Performing within tolerance. Optional housekeeping only.',
      whyDeepDive: [
        {
          metric:  'CTR',
          trend:   'up',
          value:   '12.4%',
          delta:   '+0.8% vs last week',
          context: 'Last 7 days',
          status:  'positive',
        },
        {
          metric:  'ROAS',
          trend:   'flat',
          value:   '4.6x',
          delta:   '+0.1x vs target',
          context: '7-day avg',
          status:  'positive',
        },
      ],
      actionPlan: {
        action:
          'Add three negative keywords flagged by last week\'s search-term report; no creative or bid change required.',
        imageUrl: null,
        referencePrompt: null,
      },
    },
  ],
};

export default mockFeedData;

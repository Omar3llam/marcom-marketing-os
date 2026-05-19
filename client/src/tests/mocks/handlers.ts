// ============================================================
// MARCOM v4.1 — MSW API Handlers
// ------------------------------------------------------------
// Mock Service Worker handlers for API endpoints.
//
// USAGE:
//   import { server } from './mocks/server';
//   server.use(http.get('/api/custom', () => {...}));
// ============================================================

import { http, HttpResponse } from 'msw';

/**
 * Mock Lumi Feed Response
 *
 * ⚠️ MUST match LumiFeedResponseSchema exactly!
 * See: client/src/contracts/schemas/api.schema.ts
 */
const mockLumiFeedResponse = {
  schemaVersion: '2.1.0',
  workspaceId: 'wks_test_001',
  generatedAt: '2026-05-19T12:00:00Z',
  campaigns: [
    {
      campaign_id: 'camp_test_001',
      campaign_name: 'Test Campaign 1',
      stage: 'TESTING',
      alerts: [
        {
          action_id: '550e8400-e29b-41d4-a716-446655440000',
          idempotency_key: 'idem_test_001',
          priority: 'HIGH',
          analysis: {
            verdict: 'PAUSE',
            root_cause: 'High CPA detected ($45.20 vs. $30.00 threshold). Ad fatigue likely due to 7-day constant delivery without creative refresh.',
          },
          historical_insight: 'Similar pause decisions in Q1 2026 resulted in 23% ROAS improvement after creative refresh.',
          action_plan: {
            action: 'PAUSE_CAMPAIGN',
            status: 'PENDING',
            imageUrl: null,
            reference_prompt: null,
          },
          metrics: [
            {
              metric: 'CPA',
              trend: 'up',
              value: '$45.20',
              delta: '+$15.20',
              context: 'vs. last 7 days',
              status: 'danger',
            },
            {
              metric: 'ROAS',
              trend: 'down',
              value: '1.2x',
              delta: '-0.8x',
              context: 'vs. target 2.0x',
              status: 'warning',
            },
          ],
          memory: [
            {
              actionType: 'PAUSE_CAMPAIGN',
              decisionRationale: 'High CPA with declining ROAS',
              isSustainable: false,
              impactDurationHrs: 48,
            },
          ],
          creative_assets: null,
        },
      ],
    },
  ],
};

/**
 * MSW Request Handlers
 */
export const handlers = [
  // GET /api/lumi/feed — Success response
  http.get('/api/lumi/feed', () => {
    return HttpResponse.json(mockLumiFeedResponse);
  }),

  // POST /api/execute/meta — Success response
  http.post('/api/execute/meta', async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({
      success: true,
      actionId: (body as any).idempotencyKey || 'act_executed',
    });
  }),

  // POST /api/execute/meta — Error response (for testing error handling)
  http.post('/api/execute/meta/error', () => {
    return HttpResponse.json(
      {
        success: false,
        error: 'Meta API error: Invalid credentials',
      },
      { status: 401 }
    );
  }),
];

/**
 * Export mock data for use in tests
 */
export { mockLumiFeedResponse };

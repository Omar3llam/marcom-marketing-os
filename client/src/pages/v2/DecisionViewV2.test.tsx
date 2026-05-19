// ============================================================
// MARCOM v4.1 — DecisionViewV2 Tests
// ------------------------------------------------------------
// Unit tests for DecisionViewV2 component and its sub-components.
//
// Tests:
// - Loading state rendering
// - Success state with feed data
// - Error state with retry/reset
// - Empty state (no alerts)
// - Execution flow (click execute button)
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { server } from '@/tests/mocks/server';
import { http, HttpResponse } from 'msw';
import { DecisionViewV2 } from './DecisionViewV2';
import { mockLumiFeedResponse } from '@/tests/mocks/handlers';

// Mock telemetry module
vi.mock('@/lib/telemetry', () => ({
  track: vi.fn(),
}));

/**
 * Test wrapper with Router
 */
function renderWithRouter(ui: React.ReactElement) {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
}

describe('DecisionViewV2', () => {
  describe('Loading State', () => {
    it('shows loading spinner while fetching feed', () => {
      // Delay the response to keep loading state visible
      server.use(
        http.get('/api/lumi/feed', async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return HttpResponse.json(mockLumiFeedResponse);
        })
      );

      renderWithRouter(<DecisionViewV2 />);

      expect(screen.getByText(/loading decision feed/i)).toBeInTheDocument();
      expect(screen.getByText(/analyzing campaigns/i)).toBeInTheDocument();
    });
  });

  describe('Success State', () => {
    it('renders feed header with campaign and alert counts', async () => {
      renderWithRouter(<DecisionViewV2 />);

      await waitFor(() => {
        expect(screen.getByText(/decision feed/i)).toBeInTheDocument();
      });

      expect(screen.getByText(/1 campaigns/i)).toBeInTheDocument();
      expect(screen.getByText(/1 pending decisions/i)).toBeInTheDocument();
    });

    it('renders DecisionTrustCluster for each alert', async () => {
      renderWithRouter(<DecisionViewV2 />);

      await waitFor(() => {
        expect(screen.getByText(/test campaign 1/i)).toBeInTheDocument();
      });

      expect(screen.getByText(/high cpa detected/i)).toBeInTheDocument();
    });

    it('shows execute button for READY alerts', async () => {
      renderWithRouter(<DecisionViewV2 />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /execute/i })).toBeInTheDocument();
      });
    });
  });

  describe('Empty State', () => {
    it('shows empty state when no alerts exist', async () => {
      server.use(
        http.get('/api/lumi/feed', () => {
          return HttpResponse.json({
            schemaVersion: '2.1.0',
            workspaceId: 'wks_test_001',
            generatedAt: '2026-05-19T12:00:00Z',
            campaigns: [],
          });
        })
      );

      renderWithRouter(<DecisionViewV2 />);

      await waitFor(() => {
        expect(screen.getByText(/no decisions pending/i)).toBeInTheDocument();
      });

      expect(screen.getByText(/upload a csv or connect meta ads/i)).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('shows error view when API request fails', async () => {
      server.use(
        http.get('/api/lumi/feed', () => {
          return HttpResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
          );
        })
      );

      renderWithRouter(<DecisionViewV2 />);

      await waitFor(() => {
        expect(screen.getByText(/platform error/i)).toBeInTheDocument();
      });
    });

    it('shows retry button in error state', async () => {
      server.use(
        http.get('/api/lumi/feed', () => {
          return HttpResponse.json(
            { error: 'Network error' },
            { status: 500 }
          );
        })
      );

      renderWithRouter(<DecisionViewV2 />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
      });
    });

    it('retries API call when retry button is clicked', async () => {
      let callCount = 0;
      server.use(
        http.get('/api/lumi/feed', () => {
          callCount++;
          if (callCount === 1) {
            return HttpResponse.json({ error: 'Temporary error' }, { status: 500 });
          }
          return HttpResponse.json(mockLumiFeedResponse);
        })
      );

      const user = userEvent.setup();
      renderWithRouter(<DecisionViewV2 />);

      // Wait for error state
      await waitFor(() => {
        expect(screen.getByText(/platform error/i)).toBeInTheDocument();
      });

      // Click retry
      const retryButton = screen.getByRole('button', { name: /retry/i });
      await user.click(retryButton);

      // Should show success state after retry
      await waitFor(() => {
        expect(screen.getByText(/decision feed/i)).toBeInTheDocument();
      });
    });
  });

  describe('Execution Flow', () => {
    it('calls execute API when execute button is clicked', async () => {
      let executeCalled = false;
      server.use(
        http.post('/api/execute/meta', async () => {
          executeCalled = true;
          return HttpResponse.json({ success: true, actionId: 'act_test_001' });
        })
      );

      const user = userEvent.setup();
      renderWithRouter(<DecisionViewV2 />);

      // Wait for feed to load
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /execute/i })).toBeInTheDocument();
      });

      // Click execute button
      const executeButton = screen.getByRole('button', { name: /execute/i });
      await user.click(executeButton);

      // Verify API was called
      await waitFor(() => {
        expect(executeCalled).toBe(true);
      });
    });

    it('prevents duplicate execution while action is in progress', async () => {
      let executeCallCount = 0;
      server.use(
        http.post('/api/execute/meta', async () => {
          executeCallCount++;
          await new Promise((resolve) => setTimeout(resolve, 500));
          return HttpResponse.json({ success: true, actionId: 'act_test_001' });
        })
      );

      const user = userEvent.setup();
      renderWithRouter(<DecisionViewV2 />);

      // Wait for feed to load
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /execute/i })).toBeInTheDocument();
      });

      // Click execute button twice rapidly
      const executeButton = screen.getByRole('button', { name: /execute/i });
      await user.click(executeButton);
      await user.click(executeButton);

      // Wait for execution to complete
      await waitFor(() => {
        expect(executeCallCount).toBe(1); // Should only be called once
      });
    });
  });

  describe('Telemetry Tracking', () => {
    it('tracks render time on mount and unmount', async () => {
      const { track } = await import('@/lib/telemetry');

      const { unmount } = renderWithRouter(<DecisionViewV2 />);

      // Wait for feed to load
      await waitFor(() => {
        expect(screen.getByText(/decision feed/i)).toBeInTheDocument();
      });

      // Unmount to trigger telemetry
      unmount();

      // Verify track was called with route_render event
      expect(track).toHaveBeenCalledWith(
        'route_render',
        expect.objectContaining({
          route: '/v2/decision',
          version: 'v2',
          renderTime: expect.any(Number),
        })
      );
    });
  });
});

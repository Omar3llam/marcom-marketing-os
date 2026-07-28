// ============================================================
// Admin · CostTab — AI usage and ESTIMATED cost
// ------------------------------------------------------------
// This tab shows a dollar figure that an operator may reconcile against a real
// provider invoice, so most of these tests are about the ways a plausible
// number could be a false one: an unmeasured call rendering as $0.00, a partial
// sum presented as a total, or an estimate shown without saying it is one.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

const { fetchAiUsage } = vi.hoisted(() => ({ fetchAiUsage: vi.fn() }));
vi.mock('./api.js', () => ({ fetchAiUsage }));

import { CostTab } from './CostTab.jsx';

const usage = (over = {}) => ({
  period: { days: 30, since: '2026-06-28T00:00:00.000Z' },
  totals: { calls: 120, pricedCalls: 120, unattributedCalls: 0, estimatedCost: 18.5, ...over.totals },
  byProvider: over.byProvider ?? [{
    provider: 'CLAUDE',
    calls: 120, meteredCalls: 120, pricedCalls: 120,
    inputTokens: 1_000_000, outputTokens: 1_000_000, tokens: 2_000_000,
    estimatedCost: 18.5,
    models: [{ model: 'claude-sonnet-4-5', calls: 120, meteredCalls: 120, inputTokens: 1_000_000, outputTokens: 1_000_000, estimatedCost: 18.5 }],
  }],
  byWorkspace: over.byWorkspace ?? [],
  byDay: over.byDay ?? [],
  pricingAsOf: '2026-05',
  disclaimer: 'Estimated from our own token counts against hardcoded 2026-05 pricing. Provider invoices are the source of truth — verify against them before billing anyone.',
});

const renderTab = async (data = usage()) => {
  fetchAiUsage.mockResolvedValue(data);
  render(<CostTab />);
  return screen.findByText(/AI usage/i);
};

const card = (name) => screen.getByText(name).parentElement;

beforeEach(() => {
  vi.clearAllMocks();
  fetchAiUsage.mockResolvedValue(usage());
});

describe('CostTab — the headline number', () => {
  it('renders the total estimate', async () => {
    await renderTab();
    expect(await screen.findByText('$18.50')).toBeInTheDocument();
  });

  it('states how many calls the estimate is derived from', async () => {
    await renderTab();
    expect(await screen.findByText(/Derived from 120 of 120 calls/)).toBeInTheDocument();
  });

  // The single most important rendering rule of the tab.
  it('shows an em dash — never $0.00 — when nothing could be priced', async () => {
    await renderTab(usage({
      totals: { calls: 40, pricedCalls: 0, unattributedCalls: 0, estimatedCost: null },
    }));

    expect(await screen.findByText('—')).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('explains why nothing was priced instead of leaving a blank', async () => {
    await renderTab(usage({
      totals: { calls: 40, pricedCalls: 0, unattributedCalls: 0, estimatedCost: null },
    }));

    expect(await screen.findByText(/could be priced/i)).toBeInTheDocument();
  });
});

describe('CostTab — it never poses as a bill', () => {
  it('shows the disclaimer from the server', async () => {
    await renderTab();
    expect(await screen.findByText(/invoices are the source of truth/i)).toBeInTheDocument();
  });

  it('names the pricing date next to the number', async () => {
    await renderTab();
    expect(await screen.findByText(/Pricing as of 2026-05/)).toBeInTheDocument();
  });
});

describe('CostTab — per provider', () => {
  it('renders a provider card with its token split', async () => {
    await renderTab();
    await screen.findByText('CLAUDE');

    const claude = card('CLAUDE');
    // Input and output are both 1,000,000 in the fixture — two rows, not one.
    expect(within(claude).getAllByText('1,000,000')).toHaveLength(2);
    expect(within(claude).getByText('120')).toBeInTheDocument();
  });

  it('an unpriced provider shows "—" and says why', async () => {
    await renderTab(usage({
      byProvider: [{
        provider: 'HIGGSFIELD', calls: 3, meteredCalls: 0, pricedCalls: 0,
        inputTokens: null, outputTokens: null, tokens: null,
        estimatedCost: null, models: [],
      }],
      totals: { calls: 3, pricedCalls: 0, unattributedCalls: 0, estimatedCost: null },
    }));

    await screen.findByText('HIGGSFIELD');
    expect(screen.getByText(/Not priced/i)).toBeInTheDocument();
  });

  // A cost built from 6 of 10 calls is a floor. Presenting it as the total
  // understates spend while looking complete.
  it('a partial estimate is labelled a floor, not a total', async () => {
    await renderTab(usage({
      byProvider: [{
        provider: 'CLAUDE', calls: 10, meteredCalls: 6, pricedCalls: 6,
        inputTokens: 100, outputTokens: 100, tokens: 200,
        estimatedCost: 0.0018, models: [],
      }],
    }));

    expect(await screen.findByText(/Covers 6 of 10 calls — a floor, not a total/)).toBeInTheDocument();
  });

  it('does not claim partiality when every call was priced', async () => {
    await renderTab();
    await screen.findByText('CLAUDE');
    expect(screen.queryByText(/a floor, not a total/)).not.toBeInTheDocument();
  });

  // Price varies by model, so the breakdown is the explanation for the total.
  it('breaks out the models when a provider used more than one', async () => {
    await renderTab(usage({
      byProvider: [{
        provider: 'OPENAI', calls: 20, meteredCalls: 20, pricedCalls: 20,
        inputTokens: 2_000_000, outputTokens: 0, tokens: 2_000_000,
        estimatedCost: 2.65,
        models: [
          { model: 'gpt-4o', calls: 10, estimatedCost: 2.5 },
          { model: 'gpt-4o-mini', calls: 10, estimatedCost: 0.15 },
        ],
      }],
    }));

    await screen.findByText('OPENAI');
    expect(screen.getByText('gpt-4o')).toBeInTheDocument();
    expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument();
  });
});

describe('CostTab — attribution', () => {
  it('states the unattributed count as a real number', async () => {
    await renderTab(usage({
      totals: { calls: 120, pricedCalls: 120, unattributedCalls: 35, estimatedCost: 18.5 },
    }));

    expect(await screen.findByText(/35 of 120 calls carry no workspace/)).toBeInTheDocument();
  });

  it('says nothing about attribution when everything is attributed', async () => {
    await renderTab();
    await screen.findByText('CLAUDE');
    expect(screen.queryByText(/carry no workspace/)).not.toBeInTheDocument();
  });

  it('lists top workspaces when there are any', async () => {
    await renderTab(usage({
      byWorkspace: [{ workspaceId: 'ws-abcdef12-3456', calls: 40, tokens: 900_000 }],
    }));

    expect(await screen.findByText('900,000')).toBeInTheDocument();
  });
});

describe('CostTab — the period selector', () => {
  it('requests 30 days on mount', async () => {
    await renderTab();
    expect(fetchAiUsage).toHaveBeenCalledWith(30);
  });

  it('refetches when the period changes', async () => {
    await renderTab();

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Reporting period'), { target: { value: '7' } });
    });

    expect(fetchAiUsage).toHaveBeenLastCalledWith(7);
  });
});

describe('CostTab — loading and empty', () => {
  it('shows a loading state before the data lands', () => {
    fetchAiUsage.mockReturnValue(new Promise(() => {}));
    render(<CostTab />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('an empty period says so rather than rendering $0.00', async () => {
    await renderTab(usage({
      byProvider: [],
      totals: { calls: 0, pricedCalls: 0, unattributedCalls: 0, estimatedCost: null },
    }));

    expect(await screen.findByText('No AI calls recorded in this period.')).toBeInTheDocument();
  });

  it('surfaces a failed load', async () => {
    fetchAiUsage.mockRejectedValue(new Error('Failed to load AI usage'));
    render(<CostTab />);
    expect(await screen.findByText('Failed to load AI usage')).toBeInTheDocument();
  });
});

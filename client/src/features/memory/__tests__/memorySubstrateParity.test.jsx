// ============================================================
// ACROSS Tier 1 · an unreadable memory is never rendered as an empty one
// ------------------------------------------------------------
// THE REASON THIS FILE EXISTS APART FROM MemoryView.test.jsx.
//
// FE-02 already shipped a test called "a failed briefing read is not rendered
// as 'nothing has been learned'". It passes. It has always passed. It mocks
// `useAccountBriefing` and hands it `{ briefing: null, error }` — a state the
// REAL hook could not produce for a malformed 200, because the salvage caught
// the parse failure and rebuilt a briefing object with `error` still null.
//
// So the rule was asserted against a fixture the product could not generate.
// E2E-06: if a verifier can be fooled by the fixture it is testing, the
// verifier is not accepted.
//
// This file mocks the TRANSPORT and nothing else in the chain:
//
//     api.get  →  useAccountBriefing (real)  →  MemoryView (real)
//                   →  AccountBriefing (real)  →  NetworkPanel (real)
//
// and asserts the CONSEQUENCE, never `error === true`.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The transport is held here rather than imported back. `features/` may not
// import the shared API client (arch-check CHECK 2B), and a test in this tree
// is no exception — the rule is about the directory, not about production code.
const transport = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api.js', () => ({ api: transport }));
vi.mock('@/hooks/useCollabRole.js', () => ({
  useCollabRole: () => ({ role: 'STRATEGIST', loading: false }),
  WORKSPACE_ROLE: { STRATEGIST: 'STRATEGIST', BUYER: 'BUYER', CLIENT: 'CLIENT' },
}));
// Memory's SECOND reading. Not this chain; stubbed so its own transport does
// not colour the assertions about the first.
vi.mock('@/hooks/useAccuracy.js', () => ({
  useAccuracy: () => ({ data: null, surface: null, loading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('@/hooks/usePromotePattern.js', () => ({
  usePromotePattern: () => ({
    requestPromotion: vi.fn(), grantPromotion: vi.fn(), revokePromotion: vi.fn(),
    busyId: null, error: null,
  }),
}));

import MemoryView from '../MemoryView.jsx';

const pattern = (over = {}) => ({
  id: 'p1', kind: 'FATIGUE_CEILING', statement: 'Video creative fatigues after 9 days',
  support: 4, effectiveSupport: 3.2, accuracy: 0.8, confidence: 0.72, status: 'ESTABLISHED',
  ...over,
});

const briefing = (over = {}) => ({
  workspaceId: 'ws', generatedAt: '2026-09-08T00:00:00.000Z',
  patterns: [pattern()], promotableCount: 0, conflicts: [],
  network: { status: 'NOT_CONSENTED', knowledge: 'CANNOT_ASK' },
  ...over,
});

/** Answer the briefing read with `data`; everything else is irrelevant here. */
const serve = (data) => {
  transport.get.mockImplementation((url) => (String(url).includes('/briefing')
    ? Promise.resolve({ data })
    : Promise.resolve({ data: {} })));
};

const renderMemory = async () => {
  const view = render(<MemoryRouter><MemoryView /></MemoryRouter>);
  await waitFor(() => expect(view.container.textContent).not.toMatch(/Loading learnings/i));
  return view;
};

beforeEach(() => vi.clearAllMocks());

describe('ACROSS · a briefing that failed to parse claims nothing about the account', () => {
  it('a malformed 200 does not read as "No established patterns yet"', async () => {
    // The exact defect: patterns renamed on the wire. Before this slice the
    // salvage produced `patterns: []` with `error` null, and Memory told the
    // operator Lumi had learned nothing — a claim about the product's own
    // competence, manufactured from a read it could not understand.
    const { patterns, ...renamed } = briefing();
    expect(patterns).toBeDefined();
    serve({ ...renamed, learnings: [pattern()] });
    const { container } = await renderMemory();

    expect(container.textContent).not.toMatch(/No established patterns yet/i);
    expect(container.textContent).toMatch(/couldn.t load account learnings/i);
  });

  it('a malformed 200 does not fabricate a promotable count either', async () => {
    serve({ ...briefing(), promotableCount: 'three' });
    const { container } = await renderMemory();
    expect(container.textContent).toMatch(/couldn.t load account learnings/i);
    expect(container.textContent).not.toMatch(/promotable to a rule/i);
  });

  // ── self-refutation ───────────────────────────────────────────────────────
  it('a VALID empty briefing STILL reads as "No established patterns yet"', async () => {
    // Without this the guards above would also be satisfied by a surface that
    // had stopped rendering the empty state at all, and would prove nothing.
    serve(briefing({ patterns: [], promotableCount: 0 }));
    const { container } = await renderMemory();
    expect(container.textContent).toMatch(/No established patterns yet/i);
    expect(container.textContent).not.toMatch(/couldn.t load account learnings/i);
  });

  it('a real pattern still renders, and is not swallowed by the new guard', async () => {
    serve(briefing());
    await renderMemory();
    expect(screen.getByText(/Video creative fatigues after 9 days/)).toBeInTheDocument();
  });
});

describe('ACROSS · the network panel tells three states apart, not two', () => {
  it('UNAVAILABLE does not say the account is not contributing', async () => {
    // `NetworkService.js` returns this for a CONSENTED workspace whose cohort
    // cannot be established, and the route returns it when the read fails. The
    // server refuses to call either NOT_CONSENTED — its own comment says
    // reporting that "would tell an account that opted in that it had not".
    serve(briefing({ network: { status: 'UNAVAILABLE', knowledge: 'COULD_NOT_LOOK' } }));
    const { container } = await renderMemory();

    expect(container.textContent).not.toMatch(/isn.t contributing to the anonymized network/i);
    expect(screen.queryByRole('button', { name: /join network/i })).not.toBeInTheDocument();
    expect(container.textContent).toMatch(/couldn.t read the network/i);
  });

  it('…and offers no Leave button either — the standing is what we could not read', async () => {
    serve(briefing({ network: { status: 'UNAVAILABLE', knowledge: 'COULD_NOT_LOOK' } }));
    await renderMemory();
    expect(screen.queryByRole('button', { name: /leave network/i })).not.toBeInTheDocument();
  });

  it('NOT_CONSENTED still says so, and still offers the one action that helps', async () => {
    serve(briefing({ network: { status: 'NOT_CONSENTED', knowledge: 'CANNOT_ASK' } }));
    await renderMemory();
    expect(screen.getByText(/isn.t contributing to the anonymized network/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join network/i })).toBeInTheDocument();
  });

  it('OK still renders the cohort and the way out', async () => {
    serve(briefing({ network: { status: 'OK', knowledge: 'KNOWN', cohortTag: 'EG-apparel', insights: [] } }));
    await renderMemory();
    expect(screen.getByText(/Sharing as/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /leave network/i })).toBeInTheDocument();
  });
});

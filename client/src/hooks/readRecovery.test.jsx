import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, renderHook, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/lib/api.js';
import { isRetryableReadError } from '@/design-system/states/readStatus.js';
import { useAccuracy } from './useAccuracy.js';
import { useInbox } from './useInbox.js';
import { useAccountHealth } from './useAccountHealth.js';
import { useConnectorCampaigns } from './useConnectorCampaigns.js';
import { useConnectorVerdicts } from './useConnectorVerdicts.js';
import { useConnections } from './useConnections.js';
import { InboxPanel } from '@/features/inbox/InboxPanel.jsx';
import { RoleProvider, useRoleContext } from '@/context/RoleContext.jsx';
import RoleGate from '@/components/auth/RoleGate.jsx';
vi.mock('@/lib/api.js', () => ({ api: { get: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());
const failure = (httpStatus = 503) => Object.assign(new Error('temporary'), { httpStatus });
const emptyInbox = { workspaceId: 'ws', role: 'BUYER', alerts: [], latestNarrative: null, pendingApprovals: [] };

it.each([401, 403, 409, 422])('does not retry permanent HTTP %s', (status) => {
  expect(isRetryableReadError(failure(status))).toBe(false);
});
it.each([408, 429, 500, 503])('allows transport recovery for HTTP %s', (status) => {
  expect(isRetryableReadError(failure(status))).toBe(true);
});
it('does not suggest transient retry for contract drift', () => {
  expect(isRetryableReadError(new Error('Home response failed contract validation'))).toBe(false);
});

describe.each([
  ['Inbox', useInbox, emptyInbox, 'isLoading'],
  ['health', useAccountHealth, { campaigns: [], score: null, label: null }, 'loading'],
  ['campaigns', useConnectorCampaigns, { campaigns: [] }, 'loading'],
  ['verdicts', useConnectorVerdicts, { verdicts: [], gatedOut: [] }, 'loading'],
  ['connections', useConnections, { connections: [] }, 'loading'],
])('%s repeated recovery', (_, hook, payload, loading) => {
  it('retains the current failure, then clears it on a genuinely empty success', async () => {
    const first = failure(); const second = failure(500);
    api.get.mockRejectedValueOnce(first).mockRejectedValueOnce(second).mockResolvedValueOnce({ data: payload });
    const { result } = renderHook(hook);
    await waitFor(() => expect(result.current.error).toBe(first));
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.error).toBe(second));
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current[loading]).toBe(false));
    expect(result.current.error).toBeNull();
  });
});
it('Inbox click shows recovery and only claims caught-up after fresh empty success', async () => {
  let resolve;
  api.get.mockRejectedValueOnce(failure()).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
  render(<InboxPanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry inbox' }));
  expect(screen.getByText(/Loading your inbox/)).toBeInTheDocument();
  expect(screen.queryByText(/caught up/)).not.toBeInTheDocument();
  await act(async () => resolve({ data: emptyInbox }));
  expect(await screen.findByText(/caught up/)).toBeInTheDocument();
  expect(screen.queryByText(/Couldn’t load/)).not.toBeInTheDocument();
});
it.each([403, 409])('Inbox offers no retry for permanent HTTP %s', async (status) => {
  api.get.mockRejectedValue(failure(status));
  render(<InboxPanel />);
  await screen.findByText(/Couldn’t load/);
  expect(screen.queryByRole('button', { name: 'Retry inbox' })).not.toBeInTheDocument();
});
it('role boundary stays closed during retry and opens only for a fresh authorized role', async () => {
  let resolve;
  api.get.mockRejectedValueOnce(failure()).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
  render(<MemoryRouter><RoleProvider><RoleGate role="BUYER"><p>Buyer surface</p></RoleGate></RoleProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry access check' }));
  expect(screen.queryByText('Buyer surface')).not.toBeInTheDocument();
  await act(async () => resolve({ data: { role: 'BUYER', roleStatus: 'RESOLVED' } }));
  expect(await screen.findByText('Buyer surface')).toBeInTheDocument();
});
it.each(['ROLE_UNSET', 'ROLE_UNKNOWN', 'ROLE_IDENTITY_MISSING'])('role configuration %s is not transient', async (roleReason) => {
  api.get.mockResolvedValue({ data: { role: null, roleStatus: 'UNRESOLVED', roleReason } });
  const { result } = renderHook(useRoleContext, { wrapper: RoleProvider });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.canRetry).toBe(false);
  expect(result.current.role).toBeNull();
});

it.each(['ROLE_UNKNOWN', 'ROLE_IDENTITY_MISSING'])('does not retry configuration reason %s hidden behind a 503', (roleReason) => {
  expect(isRetryableReadError({ httpStatus: 503, context: { roleReason } })).toBe(false);
  expect(isRetryableReadError({ response: { status: 503, data: { roleReason } } })).toBe(false);
});

it('accuracy clears a previous error immediately while refetching', async () => {
  let resolve;
  api.get.mockRejectedValueOnce(failure()).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
  const { result } = renderHook(useAccuracy);
  await waitFor(() => expect(result.current.error).toBeTruthy());
  act(() => { result.current.refetch(); });
  expect(result.current).toMatchObject({ loading: true, error: null, data: null, surface: null });
  const payload = {
    accountLift: { earlyWindow: null, recentWindow: null, calibrationImprovementPct: null, status: 'INSUFFICIENT_DATA' },
    calibration: { bins: [], binEdges: [], expectedCalibrationError: null, brierScore: null, accuracy: null, direction: 'CALIBRATED', sampleSize: 0 },
    velocity: { periods: [], trend: 'INSUFFICIENT_DATA', slope: null },
    coverage: { totalDecisions: 0, scored: 0, unscorable: 0, pendingMaturation: 0, dismissed: 0, notAPrediction: 0, scoredFraction: 0, verdict: 'INSUFFICIENT_DATA', note: 'No observations' },
    surface: { gated: true, headline: 'No observations', status: null, calibrationErrorPct: null, improvementPct: null, scored: 0, needed: 30 },
  };
  await act(async () => resolve({ data: payload }));
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toBeNull();
  expect(result.current.surface).toEqual(payload.surface);
});

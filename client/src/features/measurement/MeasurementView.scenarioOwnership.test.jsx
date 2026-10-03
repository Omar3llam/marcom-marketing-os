import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { MeasurementView } from './MeasurementView.jsx';

const { api, transport } = vi.hoisted(() => ({ api: { post: vi.fn() }, transport: {} }));
vi.mock('@/firebase.js', () => ({ auth: { currentUser: null } }));
vi.mock('@/lib/api.js', async (importOriginal) => {
  const actual = await importOriginal();
  transport.map = actual.mapTransportError;
  return { ...actual, api };
});
vi.mock('@/hooks/useWorkspace.js', () => ({ useWorkspace: () => ({ workspace: { currency: 'EGP' } }) }));
vi.mock('@/hooks/useIncrementality.js', () => ({ useIncrementality: () => ({ tests: [], readouts: [], loading: false }) }));
vi.mock('@/components/auth/RoleGate.jsx', () => ({ default: () => null }));

const range = (expected) => ({ low: expected, expected, high: expected });
const response = { data: { workspaceId: 'w1', scenario: {
  scenarioType: 'BUDGET_EXPANSION', change: { type: 'BUDGET_EXPANSION', deltaPct: 0.2 },
  currency: 'USD', economicsStatus: 'CONFIGURED', efficiencyStatus: 'VALID', efficiencyReason: null,
  projections: { blendedCacMinor: range(2000), volume: range(100), revenueMinor: range(500000),
    grossProfitMinor: range(250000), blendedRevenueEfficiencyAfter: range(2.5) },
  assumptions: ['20 percent budget expansion'], confidence: 0.6, basis: '20 percent projection',
} } };
const show = () => render(<MemoryRouter><MeasurementView /></MemoryRouter>);
const project = () => fireEvent.click(screen.getByRole('button', { name: 'Project' }));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const failure = (status) => status == null ? new Error('Network unavailable')
  : transport.map({ response: { status, data: {} } });
beforeEach(() => vi.resetAllMocks());

describe('Scenario current request owns presentation through the real hook and panel', () => {
  it('retracts the 20% result while the actual 80% request is pending', async () => {
    const pending = deferred();
    api.post.mockResolvedValueOnce(response).mockReturnValueOnce(pending.promise);
    show(); project();
    expect(await screen.findByText('100')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Budget change percent' }), { target: { value: '80' } });
    project();
    expect(api.post).toHaveBeenNthCalledWith(2, '/api/lumi/scenario',
      { change: { type: 'BUDGET_EXPANSION', deltaPct: 0.8 } });
    expect(screen.getByRole('textbox')).toHaveValue('80');
    expect(screen.getByRole('button', { name: 'Projecting…' })).toBeDisabled();
    expect(screen.queryByText('100')).not.toBeInTheDocument();
    expect(screen.queryByText('Projected outcome')).not.toBeInTheDocument();
    expect(screen.queryByText('60% confidence')).not.toBeInTheDocument();
    expect(screen.queryByText(/20 percent/)).not.toBeInTheDocument();
    await act(async () => pending.resolve(response));
    expect(screen.getByText('Projected outcome')).toBeInTheDocument();
  });

  it.each([500, 503, null, 400, 409, 401, 403])('a new HTTP %s failure cannot resurrect the prior result', async (status) => {
    const pending = deferred();
    api.post.mockResolvedValueOnce(response).mockReturnValueOnce(pending.promise);
    show(); project(); await screen.findByText('100'); project();
    await act(async () => pending.reject(failure(status)));
    expect(screen.queryByText('100')).not.toBeInTheDocument();
    expect(screen.queryByText('Projected outcome')).not.toBeInTheDocument();
    if (status === 403) expect(screen.getByText(/isn’t available for this seat/)).toBeInTheDocument();
    else if (status === 401) expect(screen.getByText(/session needs authentication/)).toBeInTheDocument();
    else {
      expect(screen.getByText('Couldn’t project that scenario.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Project' })).toBeEnabled();
    }
  });

  it('retracts successful absence during the next pending request', async () => {
    const pending = deferred();
    api.post.mockResolvedValueOnce({ data: { workspaceId: 'w1', scenario: null, message: 'No channel data to project yet.' } })
      .mockReturnValueOnce(pending.promise);
    show(); project(); await screen.findByText('No channel data to project yet.'); project();
    expect(screen.queryByText('No channel data to project yet.')).not.toBeInTheDocument();
    await act(async () => pending.resolve(response));
  });

  it('disabled pending submit prevents another click or implicit Enter submission', async () => {
    const user = userEvent.setup();
    const pending = deferred(); api.post.mockReturnValue(pending.promise);
    show(); await user.click(screen.getByRole('button', { name: 'Project' }));
    await user.click(screen.getByRole('button', { name: 'Projecting…' }));
    await user.click(screen.getByRole('textbox')); await user.keyboard('{Enter}');
    expect(api.post).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(response));
  });

  it.each(['mapped', 'raw'])('%s exhausted 401 is authentication, not computation or permission failure', async (shape) => {
    api.post.mockRejectedValue(shape === 'mapped' ? failure(401) : { response: { status: 401 } });
    const { container } = show(); project();
    expect(await screen.findByText('Your session needs authentication before you can project another scenario.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Couldn’t project|upgrade|Pro feature|isn’t available for this seat|retry/i);
    expect(screen.getByRole('button', { name: 'Project' })).toBeDisabled();
  });

  it('exhausted mapped 401 blocks both clicking and submitting POST #2', async () => {
    api.post.mockRejectedValue(failure(401));
    const { container } = show(); project();
    await screen.findByText(/Couldn’t project|session needs authentication/);
    project(); fireEvent.submit(container.querySelector('form'));
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('external remount permits a fresh projection after authentication recovery', async () => {
    api.post.mockRejectedValueOnce(failure(401)).mockResolvedValueOnce(response);
    const first = show(); project(); await screen.findByText(/session needs authentication/);
    first.unmount(); show(); project();
    expect(await screen.findByText('100')).toBeInTheDocument();
    expect(screen.queryByText(/session needs authentication/)).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(2);
  });
});

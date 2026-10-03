import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MeasurementView } from './MeasurementView.jsx';
import { useWorkspace } from '@/hooks/useWorkspace.js';

const { api, transport } = vi.hoisted(() => ({ api: { post: vi.fn() }, transport: {} }));
vi.mock('@/firebase.js', () => ({ auth: { currentUser: null } }));
vi.mock('@/lib/api.js', async (importOriginal) => {
  const actual = await importOriginal();
  transport.map = actual.mapTransportError;
  return { ...actual, api };
});
vi.mock('@/hooks/useWorkspace.js', () => ({ useWorkspace: vi.fn() }));
vi.mock('@/hooks/useIncrementality.js', () => ({ useIncrementality: () => ({ tests: [], readouts: [], loading: false }) }));
vi.mock('@/components/auth/RoleGate.jsx', () => ({ default: () => null }));

const show = () => render(<MemoryRouter><MeasurementView /></MemoryRouter>);
const mapTransportError = (err) => transport.map(err);
beforeEach(() => {
  vi.resetAllMocks();
  useWorkspace.mockReturnValue({ workspace: { plan: 'PRO', currency: 'EGP' } });
});

describe('Scenario refusal reaches Measurement through real hook, mapper and panel', () => {
  it.each(['BUYER', 'CLIENT'])('PRO workspace %s refusal never recommends a commercial upgrade', async (role) => {
    api.post.mockRejectedValue(mapTransportError({ response: { status: 403, data: { error: 'RoleForbidden', role } } }));
    const { container } = show();
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    expect(await screen.findByText('Scenario projection isn’t available for this seat.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/upgrade|\bPRO\b|subscription|payment|billing/i);
    expect(screen.queryByRole('button', { name: /retry|project/i })).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/api/lumi/scenario', { change: { type: 'BUDGET_EXPANSION', deltaPct: 0.2 } });
  });
  it.each(['FREE', 'GROWTH'])('%s workspace preserves explicit PRO paywall', async (current) => {
    useWorkspace.mockReturnValue({ workspace: { plan: current, currency: 'EGP' } });
    api.post.mockRejectedValue(mapTransportError({ response: { status: 403,
      data: { error: 'PLAN_REQUIRED', required: 'PRO', current } } }));
    show(); fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    expect(await screen.findByText(/Scenario projection is a Pro feature/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View plans/i })).toHaveAttribute('href', '/#pricing');
    expect(screen.queryByText(/isn’t available for this seat/i)).not.toBeInTheDocument();
  });
  it('successful empty retains its established message rather than refusal or failure', async () => {
    api.post.mockResolvedValue({ data: { workspaceId: 'w1', scenario: null, message: 'No channel data to project yet.' } });
    show(); fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    expect(await screen.findByText('No channel data to project yet.')).toBeInTheDocument();
    expect(screen.queryByText(/Pro feature|isn’t available|Couldn’t project/i)).not.toBeInTheDocument();
  });
  it.each([503, 500, 400, 409])('HTTP %s reaches existing failure presentation', async (status) => {
    api.post.mockRejectedValue(mapTransportError({ response: { status, data: { error: 'Request refused' } } }));
    show(); fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    expect(await screen.findByText('Couldn’t project that scenario.')).toBeInTheDocument();
    expect(screen.queryByText(/Pro feature|isn’t available/i)).not.toBeInTheDocument();
  });
});

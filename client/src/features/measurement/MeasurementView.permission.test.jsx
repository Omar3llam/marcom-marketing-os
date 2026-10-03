import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MeasurementView } from './MeasurementView.jsx';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api.js', () => ({ api }));
vi.mock('@/hooks/useScenario.js', () => ({ useScenario: () => ({ run: vi.fn() }) }));
vi.mock('@/hooks/useWorkspace.js', () => ({ useWorkspace: () => ({ workspace: { currency: 'EGP' } }) }));
vi.mock('@/components/auth/RoleGate.jsx', () => ({ default: ({ children }) => children }));

beforeEach(() => vi.clearAllMocks());
const show = () => render(<MemoryRouter><MeasurementView /></MemoryRouter>);

describe('Measurement list permission presentation through the real hook and panel', () => {
  it.each([
    { httpStatus: 403, code: 'PLAN_REQUIRED' },
    { response: { status: 403, data: { error: 'PLAN_REQUIRED' } } },
  ])('plan refusal %j states PRO and upgrade, never measurement depth', async (err) => {
    api.get.mockRejectedValue(err);
    const { container } = show();
    expect(await screen.findByText(/holdout testing requires the Pro plan/i)).toBeInTheDocument();
    expect(container.textContent).toMatch(/upgrad/i);
    expect(container.textContent).not.toMatch(/Agency|Enterprise|No holdouts yet|couldn’t load incrementality/);
    expect(screen.queryByRole('button', { name: /retry|try again/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Channel$/)).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it.each([
    { httpStatus: 403, code: 'AUTH_ACCESS_DENIED', message: 'MeasurementGated' },
    { response: { status: 403, data: { error: 'MeasurementGated' } } },
  ])('measurement-depth refusal %j retains its separate capability meaning', async (err) => {
    api.get.mockRejectedValue(err);
    const { container } = show();
    expect(await screen.findByText(/Agency\/Enterprise capability/)).toBeInTheDocument();
    expect(container.textContent).toMatch(/aren’t enabled for this workspace/);
    expect(container.textContent).not.toMatch(/upgrade|requires the Pro plan|No holdouts yet/);
    expect(screen.queryByRole('button', { name: /retry|try again/i })).not.toBeInTheDocument();
  });

  it.each([
    { httpStatus: 403, code: 'INVITATION_INVALID', message: 'Access denied' },
    { response: { status: 403, data: { error: 'RoleForbidden' } } },
  ])('generic refusal %j does not invent a plan or tier diagnosis', async (err) => {
    api.get.mockRejectedValue(err);
    const { container } = show();
    expect(await screen.findByText('Access to holdout testing was refused for this request.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/upgrade|Agency|Enterprise|Pro plan|No holdouts yet|couldn’t load incrementality/);
    expect(screen.queryByRole('button', { name: /retry|try again/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Channel$/)).not.toBeInTheDocument();
  });

  it.each([{ httpStatus: 500 }, new Error('offline')])('failure %j remains an error rather than a lock or empty list', async (err) => {
    api.get.mockRejectedValue(err);
    const { container } = show();
    expect(await screen.findByText(/couldn’t load incrementality/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Agency|Enterprise|No holdouts yet|refused/);
  });

  it('successful empty list shows the design form and honest empty state', async () => {
    api.get.mockResolvedValue({ data: { workspaceId: 'w1', tests: [] } });
    show();
    expect(await screen.findByText(/No holdouts yet/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Channel$/)).toBeInTheDocument();
  });

  it('contract-invalid success shows failure rather than empty or permission copy', async () => {
    api.get.mockResolvedValue({ data: { workspaceId: 'w1', tests: 'invalid' } });
    const { container } = show();
    expect(await screen.findByText(/couldn’t load incrementality/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/No holdouts yet|Agency|Enterprise|refused/);
  });

  it('a valid populated response renders the existing holdout row and destination', async () => {
    api.get.mockResolvedValue({ data: { workspaceId: 'w1', tests: [{
      id: 'h1', workspaceId: 'w1', name: 'Meta holdout', channel: 'META', holdoutPct: 0.1,
      mde: 0.1, sampleSizePerArm: 1000, durationDays: 14, status: 'DESIGNED',
    }] } });
    show();
    expect(await screen.findByRole('link', { name: 'Meta holdout' })).toHaveAttribute('href', '/app/measure/h1');
    expect(screen.queryByText(/No holdouts yet/)).not.toBeInTheDocument();
  });
});

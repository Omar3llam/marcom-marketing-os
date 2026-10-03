import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ProtectedRoute, OnboardingRoute, primeContextCache, clearContextCache } from '../ProtectedRoute.jsx';

const { session, get } = vi.hoisted(() => ({
  session: { currentUser: { uid: 'u1' }, loading: false, authReady: true }, get: vi.fn(),
}));
vi.mock('@/context/AuthContext.jsx', () => ({ useAuth: () => session }));
vi.mock('@/lib/api.js', () => ({ api: { get } }));

function Location() { return <span data-testid="location">{useLocation().pathname}</span>; }
function tree(guard) {
  return <MemoryRouter initialEntries={[guard === 'protected' ? '/app/overview' : '/onboarding']}>
    <Location />
    <Routes>
      <Route path="/app/*" element={guard === 'protected'
        ? <ProtectedRoute><p>app-content</p></ProtectedRoute> : <p>app-content</p>} />
      <Route path="/onboarding" element={guard === 'onboarding'
        ? <OnboardingRoute><p>onboarding-content</p></OnboardingRoute> : <p>onboarding-content</p>} />
      <Route path="/login" element={<p>login-content</p>} />
    </Routes>
  </MemoryRouter>;
}
const show = (guard) => render(tree(guard));
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
};
let errorSpy;
beforeEach(() => {
  get.mockReset(); session.currentUser = { uid: 'u1' }; session.loading = false; session.authReady = true;
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

describe.each(['protected', 'onboarding'])('%s GET envelope truth', (guard) => {
  it.each([
    ['missing context', {}], ['undefined context', { context: undefined }],
    ['string context', { context: 'bad' }], ['number context', { context: 1 }],
    ['boolean context', { context: false }], ['array context', { context: [] }],
    ['null envelope', null], ['undefined envelope', undefined], ['array envelope', []],
    ['inherited context', Object.create({ context: { name: 'Acme' } })],
  ])('unreadable %s cannot decide app or onboarding', async (_name, payload) => {
    get.mockResolvedValue({ data: payload }); show(guard);
    expect(await screen.findByRole('alert')).toHaveTextContent('Your account setup could not be read');
    expect(screen.queryByText('app-content')).not.toBeInTheDocument();
    expect(screen.queryByText('onboarding-content')).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(guard === 'protected' ? '/app/overview' : '/onboarding');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['explicit null', null, false], ['explicit incomplete object', {}, false],
    ['current name', { name: 'Acme' }, true], ['legacy name', { companyName: 'Acme' }, true],
    ['whitespace name', { name: '   ' }, false],
    ['historical unknown fields', { name: 'Acme', legacy: ['extra'], arbitrary: { data: 1 } }, true],
  ])('preserves %s completion compatibility', async (_name, context, complete) => {
    get.mockResolvedValue({ data: { context, extraEnvelopeField: 'accepted' } }); show(guard);
    expect(await screen.findByText(complete ? 'app-content' : 'onboarding-content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('retry enters loading again before a malformed recovery stays unreadable', async () => {
    const pending = deferred();
    get.mockRejectedValueOnce({ httpStatus: 503 }).mockReturnValueOnce(pending.promise);
    show(guard); fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('status')).toHaveTextContent('Checking your account');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => pending.resolve({ data: {} }));
    expect(screen.getByRole('alert')).toHaveTextContent('could not be read');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByText('app-content')).not.toBeInTheDocument();
    expect(screen.queryByText('onboarding-content')).not.toBeInTheDocument();
  });

  it('superseded session read cannot publish a late setup answer', async () => {
    const old = deferred(); const current = deferred();
    get.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const view = show(guard);
    expect(screen.getByRole('status')).toBeInTheDocument();
    session.currentUser = { uid: 'u2' }; view.rerender(tree(guard));
    await act(async () => old.resolve({ data: { context: { name: 'Old user' } } }));
    expect(screen.queryByText('app-content')).not.toBeInTheDocument();
    expect(screen.queryByText('onboarding-content')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    await act(async () => current.resolve({ data: {} }));
    expect(screen.getByRole('alert')).toHaveTextContent('could not be read');
  });
});

it('a cancelled read cannot publish into a newer mounted guard', async () => {
  const old = deferred(); const current = deferred();
  get.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const first = show('protected'); first.unmount(); show('onboarding');
  await act(async () => old.resolve({ data: { context: { name: 'Old user' } } }));
  expect(screen.getByRole('status')).toHaveTextContent('Checking your account');
  expect(screen.queryByText('app-content')).not.toBeInTheDocument();
  await act(async () => current.resolve({ data: { context: null } }));
  expect(screen.getByText('onboarding-content')).toBeInTheDocument();
});

it('explicit local prime and clear retain their envelope-independent behavior', async () => {
  get.mockReturnValue(new Promise(() => {})); show('protected');
  act(() => primeContextCache({ companyName: 'Acme', legacyField: true }));
  expect(screen.getByText('app-content')).toBeInTheDocument();
  act(() => clearContextCache());
  expect(await screen.findByText('onboarding-content')).toBeInTheDocument();
});

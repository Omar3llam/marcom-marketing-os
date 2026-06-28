// ============================================================
// Onboarding completion ALWAYS lands on Overview (Bug 2 fix)
// ============================================================
// A brand-new user finishing onboarding must land on Overview — never on an
// arbitrary ?next= deep link (e.g. /app/settings/security). The ?next= "return
// where you were" param is for RETURNING users re-authenticating (honored at
// AuthPage), not first-time onboarding. We stub the step bodies (this exercises
// the wizard's completion → navigation, not each step's form UI); DEFAULTS with
// name+industry seeded satisfies validate() at every step.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const navigateSpy = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigateSpy };
});
vi.mock('@/context/AuthContext.jsx', () => ({
  useAuth: () => ({ currentUser: { displayName: 'Acme', email: 'a@b.co' } }),
}));
vi.mock('@/lib/api.js', () => ({
  api: { put: vi.fn().mockResolvedValue({ data: { user: { context: { name: 'Acme' } } } }) },
}));
vi.mock('@/router/ProtectedRoute.jsx', () => ({ primeContextCache: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Step bodies are irrelevant to this test — stub them so navigation is decoupled
// from each step's form internals.
vi.mock('./steps/WelcomeStep.jsx', () => ({ WelcomeStep: () => <div>welcome</div> }));
vi.mock('./steps/IdentityStep.jsx', () => ({ IdentityStep: () => <div>identity</div> }));
vi.mock('./steps/IndustryStep.jsx', () => ({ IndustryStep: () => <div>industry</div> }));
vi.mock('./steps/AudienceStep.jsx', () => ({ AudienceStep: () => <div>audience</div> }));
vi.mock('./steps/VoiceStep.jsx', () => ({ VoiceStep: () => <div>voice</div> }));
vi.mock('./steps/ChannelsStep.jsx', () => ({ ChannelsStep: () => <div>channels</div> }));
vi.mock('./steps/SpendStep.jsx', () => ({ SpendStep: () => <div>spend</div> }));
vi.mock('./steps/ObjectiveStep.jsx', () => ({ ObjectiveStep: () => <div>objective</div> }));
vi.mock('./steps/ReviewStep.jsx', () => ({ ReviewStep: () => <div>review</div> }));
// Seed industry (DEFAULTS leaves it empty) so the industry step validates; name
// comes from the mocked currentUser.displayName.
vi.mock('./constants.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, DEFAULTS: { ...actual.DEFAULTS, industry: 'ecommerce' } };
});

import OnboardingPage from './index.jsx';

async function completeOnboarding(initialUrl) {
  render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <OnboardingPage />
    </MemoryRouter>,
  );
  // Welcome → … → Objective (8 "Continue" clicks), then the final "Launch Lumi".
  for (let i = 0; i < 8; i++) {
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
  }
  fireEvent.click(screen.getByRole('button', { name: /launch lumi/i }));
  await waitFor(() => expect(navigateSpy).toHaveBeenCalled());
}

describe('OnboardingPage — completion always lands on Overview (Bug 2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('navigates to /app/overview after onboarding (no ?next=)', async () => {
    await completeOnboarding('/onboarding');
    expect(navigateSpy).toHaveBeenCalledWith('/app/overview', { replace: true });
  });

  it('IGNORES ?next= and still lands on /app/overview — never the deep link', async () => {
    await completeOnboarding('/onboarding?next=/app/settings/security');
    expect(navigateSpy).toHaveBeenCalledWith('/app/overview', { replace: true });
    expect(navigateSpy).not.toHaveBeenCalledWith('/app/settings/security', expect.anything());
  });
});

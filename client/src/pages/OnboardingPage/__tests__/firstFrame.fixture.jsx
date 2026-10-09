// Test-only entry: imported only by firstFrame.browser.cjs, never by App/routes.
// Synthetic dependencies are supplied by that runner's isolated Vite plugin.
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { BrowserRouter } from 'react-router-dom';
import OnboardingPage from '../index.jsx';
import { ReadyStep } from '../steps/ReadyStep.jsx';
import { ONBOARDING_NAME_KEY } from '../steps/onboardingStyles.js';
import '@/index.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/space-grotesk/700.css';

export const root = createRoot(document.getElementById('root'));
const populated = {
  verdicts: [
    { verdict: 'SCALE', name: 'Synthetic lower spend', spendMinor: 100, confidence: 0.7 },
    { verdict: 'KILL', name: 'Synthetic highest spend', spendMinor: 200, confidence: 0.8,
      rationale: 'Synthetic supplied rationale.', recommendation: 'Synthetic supplied recommendation.' },
  ],
  campaigns: [{ id: 'synthetic-one' }, { id: 'synthetic-two' }],
};

window.mountFirstFrameFixture = ({ step = 'ready', variant = 'present', isolated = false }) => {
  const pending = variant === 'pending';
  const failed = variant === 'failed';
  const values = variant === 'empty' ? { verdicts: [], campaigns: [] } : populated;
  window.__onboardingFixture = {
    verdicts: { verdicts: values.verdicts, loading: pending, error: null },
    campaigns: { campaigns: values.campaigns, loading: pending, error: failed ? new Error('Synthetic read failure') : null },
    connections: { data: { connections: [{ platform: 'META', connected: true }] }, loading: false, error: null },
    activations: 0,
  };
  window.history.replaceState({}, '', `/onboarding?step=${step}`);
  localStorage.setItem(ONBOARDING_NAME_KEY, 'Synthetic Workspace');
  // Remount actual production components, including their own keyed step body.
  flushSync(() => root.render(
    <BrowserRouter key={`${step}-${variant}-${isolated}`}>
      <p role="note">SYNTHETIC COMPONENT TEST — controlled reads; no live session or customer evidence.</p>
      <main id="subject">
        {isolated
          ? <ReadyStep onEnterApp={() => { window.__onboardingFixture.activations += 1; }} />
          : <OnboardingPage />}
      </main>
    </BrowserRouter>,
  ));
};

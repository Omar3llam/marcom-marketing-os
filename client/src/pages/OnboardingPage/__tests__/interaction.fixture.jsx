// Test-only composition: real onboarding page/controls, synthetic reads/actions.
import { flushSync } from 'react-dom';
import { BrowserRouter } from 'react-router-dom';
import { root } from './firstFrame.fixture.jsx';
import './focus.fixture.jsx';
import OnboardingPage from '../index.jsx';

window.mountInteractionPage = (step, refusal = false) => {
  window.mountFirstFrameFixture({ step: 'ready' });
  window.__onboardingFixture.connections = {
    data: { workspaceId: 'synthetic-workspace', connections: [] }, loading: false, error: null,
  };
  window.__interactionSave = { calls: 0 };
  window.history.replaceState({}, '', `/onboarding?step=${step}${refusal ? '&meta_error=role_forbidden' : ''}`);
  flushSync(() => root.render(
    <BrowserRouter key={`interaction-${step}`}>
      <p role="note">SYNTHETIC COMPONENT TEST — local reads/actions; no live session, OAuth or backend.</p>
      <main id="subject"><OnboardingPage /></main>
    </BrowserRouter>,
  ));
};

// A local preview is also available for native browser inspection.
window.mountInteractionPage(new URLSearchParams(location.search).get('step') || 'name');

// Test-only entry. Controlled reads/callbacks; no App, session or OAuth mounted.
import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { root } from './firstFrame.fixture.jsx';
import { ConnectStep } from '../steps/ConnectStep.jsx';
import { ReadyStep } from '../steps/ReadyStep.jsx';
import { PAGE } from '../steps/onboardingStyles.js';

window.mountPublishedFixture = (config) => {
  window.__published = { ...config, calls: { next: 0, skip: 0, enter: 0, connect: 0, checks: 0 } };
  window.history.replaceState({}, '', '/onboarding?step=' + config.step + (config.query || ''));
  const count = (name) => () => { window.__published.calls[name] += 1; };
  flushSync(() => root.render(
    <StrictMode key={config.name}>
      <p role="note">SYNTHETIC P9-06 — published-shape reads and local callbacks; no live auth, OAuth or backend.</p>
      <main data-lumi-env="product" className={`min-h-screen flex items-center justify-center px-4 sm:px-6 ${PAGE}`}>
        <div id="subject" className="w-full max-w-[580px] px-0 sm:px-8">
          {config.step === 'connect'
            ? <ConnectStep onConnected={count('next')} onSkip={count('skip')} />
            : <ReadyStep onEnterApp={count('enter')} />}
        </div>
      </main>
    </StrictMode>,
  ));
};

// SYNTHETIC: actual page and CSS, controlled published-shape reads; no auth/OAuth.
import { flushSync } from 'react-dom';
import { BrowserRouter } from 'react-router-dom';
import { root } from './firstFrame.fixture.jsx';
import OnboardingPage from '../index.jsx';
let mountId = 0;

window.mountComposition = (config) => {
  window.__composition = config;
  window.history.replaceState({}, '', `/onboarding?step=${config.step}${config.query || ''}`);
  localStorage.setItem('marcom:onboarding:name', 'Synthetic Workspace');
  flushSync(() => root.render(
    <BrowserRouter key={`${config.name}-${++mountId}`}>
      <p role="note">SYNTHETIC P9-08 — actual UI; supplied test evidence, no live session/OAuth/customer result.</p>
      <div id="subject"><OnboardingPage /></div>
    </BrowserRouter>,
  ));
};

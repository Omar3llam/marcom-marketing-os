// Isolated browser test only. Reuse P9-02's CSS, real components and labelled data.
import { flushSync } from 'react-dom';
import { useState } from 'react';
import { root } from './firstFrame.fixture.jsx';
import { NameStep } from '../steps/NameStep.jsx';
import { ConnectStep } from '../steps/ConnectStep.jsx';
import { SyncStep } from '../steps/SyncStep.jsx';
import { ReadyStep } from '../steps/ReadyStep.jsx';
import { PAGE, ONBOARDING_NAME_KEY } from '../steps/onboardingStyles.js';

function ConnectFixture({ state, onConnected, onSkip }) {
  const [saving, setSaving] = useState(state === 'connect-saving');
  window.setFocusSaving = () => flushSync(() => setSaving(true));
  return <ConnectStep onConnected={onConnected} onSkip={onSkip} saving={saving} />;
}

window.mountFocusFixture = (state) => {
  window.mountFirstFrameFixture({ variant: state === 'ready-failed' ? 'failed' : state === 'ready-empty' ? 'empty' : state === 'ready-pending' ? 'pending' : 'present' });
  const fixture = window.__onboardingFixture;
  fixture.connections = { data: { connections: [] }, loading: false, error: null };
  fixture.project = { projectId: state === 'connect-missing' ? null : 'synthetic', loading: state === 'connect-loading' };
  fixture.calls = { connect: 0, sync: 0, next: 0, enter: 0, skip: 0 };
  fixture.sync = state;
  window.history.replaceState({}, '', `/onboarding?step=connect${state.startsWith('connect-failed') ? '&meta_error=server_error' : ''}`);
  localStorage.setItem(ONBOARDING_NAME_KEY, state === 'name-empty' ? '' : 'Synthetic Workspace');
  const count = (name) => () => { fixture.calls[name] += 1; };
  let component;
  if (state.startsWith('name')) component = <NameStep onNext={count('next')} />;
  else if (state.startsWith('connect')) component = <ConnectFixture state={state} onConnected={count('next')} onSkip={count('skip')} />;
  else if (state.startsWith('sync')) component = <SyncStep onComplete={count('next')} />;
  else component = <ReadyStep onEnterApp={count('enter')} />;
  flushSync(() => root.render(
    <div key={state}>
      <p role="note">SYNTHETIC COMPONENT TEST — controlled reads and callbacks; no live session, OAuth or backend.</p>
      <main className={`min-h-screen flex items-center justify-center px-4 sm:px-6 ${PAGE}`}>
        <div id="subject" className="w-full max-w-[580px] px-0 sm:px-8">{component}</div>
      </main>
    </div>,
  ));
};

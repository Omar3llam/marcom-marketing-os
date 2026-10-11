import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext.jsx';
import { api } from '@/lib/api.js';
import { appRoutes } from '@/app/routeManifest.js';
import { NameStep } from './steps/NameStep.jsx';
import { ConnectStep } from './steps/ConnectStep.jsx';
import { SyncStep } from './steps/SyncStep.jsx';
import { ReadyStep } from './steps/ReadyStep.jsx';
import { ONBOARDING_NAME_KEY, PAGE, GHOST_BTN } from './steps/onboardingStyles.js';

// Connect → Verdict → Enrich. Gate on a workspace name only; the rest is
// deferred (progressive profiling, separate PR). The step lives in the URL so it
// survives the OAuth full-page redirect. Context is written to the backend only
// AFTER the OAuth round-trip — writing it earlier flips `hasContext` true and
// OnboardingRoute bounces the user to /app mid-flow.
const STEPS = ['name', 'connect', 'sync', 'ready'];

// The label under each progress bar — names what the user is doing, so the flow
// reads as a route to a verdict rather than an anonymous 4-bar wizard.
const STEP_LABELS = ['Workspace', 'Connect', 'Analyze', 'Verdict'];

function readName() {
  try { return (localStorage.getItem(ONBOARDING_NAME_KEY) || '').trim(); } catch { return ''; }
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [workspaceName, setWorkspaceName] = useState(readName);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const operation = useRef({ id: 0, locked: false, action: null });
  const mounted = useRef(true);

  const [step, setStep] = useState(() => {
    const p = new URLSearchParams(window.location.search).get('step');
    return STEPS.includes(p) ? p : 'name';
  });
  const stepRef = useRef(step);
  useEffect(() => {
    mounted.current = true;
    const current = operation.current;
    return () => { mounted.current = false; current.id += 1; };
  }, []);

  const goTo = useCallback((s) => {
    if (!mounted.current) return;
    operation.current.id += 1;
    operation.current.locked = false;
    stepRef.current = s;
    setSaving(false);
    setSaveError(null);
    window.history.replaceState({}, '', `/onboarding?step=${s}`);
    setStep(s);
  }, []);

  const clearName = () => { try { localStorage.removeItem(ONBOARDING_NAME_KEY); } catch { /* ignore */ } };

  // Keep request ownership local: repeated clicks and callbacks from an old step
  // cannot publish an advancement, even if their request eventually succeeds.
  const persistAndAdvance = useCallback(async (action) => {
    const expectedStep = action === 'skip' ? 'connect' : 'sync';
    if (!mounted.current || operation.current.locked || stepRef.current !== expectedStep) return false;
    const id = ++operation.current.id;
    operation.current.locked = true;
    operation.current.action = action;
    setSaving(true);
    setSaveError(null);
    const ownsRequest = () => mounted.current && operation.current.id === id && stepRef.current === expectedStep;
    try {
      if (!workspaceName) throw new Error('Missing workspace name');
      const response = await api.put('/api/campaigns/me/context', {
        context: { name: workspaceName }, workspaceName, email: currentUser?.email,
      });
      if (response.data?.ok !== true) throw new Error('Context save not confirmed');
      if (!ownsRequest()) return false;
      if (action === 'skip') {
        setSaving(false);
        clearName();
        navigate(appRoutes.overview, { replace: true });
      } else goTo('ready');
      return true;
    } catch {
      if (ownsRequest()) {
        setSaveError(workspaceName
          ? 'We couldn’t save your workspace. Your name is kept here. Try again.'
          : 'Your workspace name is unavailable. Return to Workspace to enter it again.');
        operation.current.locked = false;
        setSaving(false);
      }
      return false;
    }
  }, [workspaceName, currentUser?.email, navigate, goTo]);
  const handleSyncDone = useCallback(() => persistAndAdvance('sync'), [persistAndAdvance]);
  const handleSkip = useCallback(() => persistAndAdvance('skip'), [persistAndAdvance]);
  const handleConnected = useCallback(() => {
    if (!operation.current.locked && stepRef.current === 'connect') goTo('sync');
  }, [goTo]);

  const handleEnterApp = useCallback(() => {
    clearName();
    navigate(appRoutes.campaigns, { replace: true });
  }, [navigate]);

  const idx = STEPS.indexOf(step);

  return (
    <div className={`min-h-screen flex items-center justify-center px-4 sm:px-6 ${PAGE}`}>
      {/* px-8 applied at every width, so a 375px phone lost 64px of an already
          narrow column for nothing. */}
      <div className="w-full max-w-[580px] px-0 sm:px-8">
        <div className="mb-10">
          <div className="flex gap-1.5 mb-2" aria-hidden="true">
            {STEPS.map((s, i) => (
              <div
                key={s}
                // On the light surface the track needs border-strong: plain
                // lumi-border (#EDEAE4) against bg-lumi-bg (#F8F6F2) is a ghost.
                // The fill is lumi-accent, not lumi-gold — #F6C945 on a
                // near-white page is 1.34:1 and effectively disappears.
                className={`h-1 flex-1 rounded-full transition-none ${
                  i <= idx ? 'bg-lumi-accent' : 'bg-lumi-border-strong'
                }`}
              />
            ))}
          </div>
          <ol className="flex gap-1.5" aria-label="Onboarding steps">
            {STEP_LABELS.map((label, i) => (
              <li
                key={label}
                aria-current={i === idx ? 'step' : undefined}
                // Readable labels stay static. Weight, underline and native
                // current-step semantics distinguish the current route stage.
                className={`flex-1 text-sm font-body transition-none ${
                  i === idx ? 'text-lumi-text font-semibold underline underline-offset-4' : 'text-lumi-muted'
                }`}
              >
                {label}
              </li>
            ))}
          </ol>
        </div>

        {/* Preserve each step's keyed lifecycle without delaying its content
            behind an entrance animation. */}
        <div key={step}>
          {step === 'name' && <NameStep onNext={(name) => { setWorkspaceName(name); goTo('connect'); }} />}
          {step === 'connect' && <ConnectStep onConnected={handleConnected} onSkip={handleSkip} saving={saving} />}
          {step === 'sync' && <SyncStep onComplete={handleSyncDone} />}
          {step === 'ready' && <ReadyStep onEnterApp={handleEnterApp} />}
        </div>
        {saving && <p role="status" className="text-sm text-lumi-muted mt-4">Saving your workspace…</p>}
        {saveError && (
          <div className="mt-4">
            <p role="alert" className="text-sm text-signal-kill mb-3">{saveError}</p>
            <button type="button" className={GHOST_BTN} disabled={saving}
              onClick={() => workspaceName ? persistAndAdvance(operation.current.action) : goTo('name')}>
              {workspaceName ? 'Retry saving workspace' : 'Return to Workspace'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

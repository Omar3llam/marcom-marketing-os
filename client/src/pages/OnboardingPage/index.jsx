import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext.jsx';
import { api } from '@/lib/api.js';
import { appRoutes } from '@/app/routeManifest.js';
import { NameStep } from './steps/NameStep.jsx';
import { ConnectStep } from './steps/ConnectStep.jsx';
import { SyncStep } from './steps/SyncStep.jsx';
import { ReadyStep } from './steps/ReadyStep.jsx';
import { ONBOARDING_NAME_KEY } from './steps/onboardingStyles.js';

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

  const [step, setStep] = useState(() => {
    const p = new URLSearchParams(window.location.search).get('step');
    return STEPS.includes(p) ? p : 'name';
  });

  const goTo = useCallback((s) => {
    window.history.replaceState({}, '', `/onboarding?step=${s}`);
    setStep(s);
  }, []);

  // Write the name-only context. Best-effort: if it fails, ProtectedRoute simply
  // re-checks on /app entry (and bounces back here to retry) — never a dead end.
  const persistContext = useCallback(async () => {
    const name = readName() || 'My Workspace';
    try {
      await api.put('/api/campaigns/me/context', {
        context: { name },
        workspaceName: name,
        email: currentUser?.email,
      });
    } catch { /* ProtectedRoute is the backstop */ }
  }, [currentUser]);

  const clearName = () => { try { localStorage.removeItem(ONBOARDING_NAME_KEY); } catch { /* ignore */ } };

  const handleSyncDone = useCallback(async () => {
    await persistContext();       // onboarded in the DB, past the OAuth reload
    goTo('ready');
  }, [persistContext, goTo]);

  const handleSkip = useCallback(async () => {
    await persistContext();
    clearName();
    navigate(appRoutes.overview, { replace: true });
  }, [persistContext, navigate]);

  const handleEnterApp = useCallback(() => {
    clearName();
    navigate(appRoutes.campaigns, { replace: true });
  }, [navigate]);

  const idx = STEPS.indexOf(step);

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-base px-6">
      <div className="w-full max-w-[580px] px-8">
        <div className="mb-10">
          <div className="flex gap-1.5 mb-2" aria-hidden="true">
            {STEPS.map((s, i) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-all duration-500 ease-out ${
                  i <= idx ? 'bg-lumi-gold' : 'bg-lumi-border'
                }`}
              />
            ))}
          </div>
          <div className="flex gap-1.5">
            {STEP_LABELS.map((label, i) => (
              <span
                key={label}
                className={`flex-1 text-[10px] font-medium transition-colors duration-300 ${
                  i === idx ? 'text-lumi-gold' : i < idx ? 'text-lumi-text/50' : 'text-lumi-muted/40'
                }`}
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* key={step} remounts the wrapper so the entrance animation replays on
            every step change. Safe here: the steps are already conditionally
            mounted, so this changes nothing but the animation. */}
        <div key={step} className="animate-step-in">
          {step === 'name' && <NameStep onNext={() => goTo('connect')} />}
          {step === 'connect' && <ConnectStep onConnected={() => goTo('sync')} onSkip={handleSkip} />}
          {step === 'sync' && <SyncStep onComplete={handleSyncDone} />}
          {step === 'ready' && <ReadyStep onEnterApp={handleEnterApp} />}
        </div>
      </div>
    </div>
  );
}

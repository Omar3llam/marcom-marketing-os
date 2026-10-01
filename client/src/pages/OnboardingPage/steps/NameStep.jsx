import { useState, useRef } from 'react';
import { ArrowRight } from 'lucide-react';
import { PRIMARY_BTN, INPUT, ONBOARDING_NAME_KEY } from './onboardingStyles.js';

// Step 1 — the only field on the first-verdict critical path. Persists to
// localStorage (survives the OAuth redirect); the backend context is written
// later, after connect + sync.
export function NameStep({ onNext }) {
  const [error, setError] = useState(false);
  const advanced = useRef(false);
  const [name, setName] = useState(() => {
    try { return localStorage.getItem(ONBOARDING_NAME_KEY) ?? ''; } catch { return ''; }
  });

  const advance = () => {
    const trimmed = name.trim();
    if (!trimmed || advanced.current) return;
    try { localStorage.setItem(ONBOARDING_NAME_KEY, trimmed); } catch { setError(true); return; }
    setError(false);
    advanced.current = true;
    onNext(trimmed);
  };

  return (
    <div>
      <h1 className="decision-title text-lumi-text mb-2">What&apos;s your workspace called?</h1>
      <p className="text-sm text-lumi-muted mb-6">This is how Lumi identifies your account.</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') advance(); }}
        placeholder="e.g. Acme Marketing"
        aria-label="Workspace name"
        autoFocus
        className={`${INPUT} mb-4`}
      />
      <button type="button" onClick={advance} disabled={!name.trim()} className={PRIMARY_BTN}>
        Continue <ArrowRight className="w-4 h-4" strokeWidth={2} />
      </button>
      {error && <p role="alert" className="text-sm text-signal-kill mt-3">We couldn’t keep your workspace name for the connection step. Check browser storage and try Continue again.</p>}
    </div>
  );
}

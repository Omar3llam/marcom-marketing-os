import { useEffect, useState } from 'react';
import { ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { useConnections } from '@/hooks/useConnections.js';
import { useProjectId } from '@/hooks/useProjectId.js';
import { startConnect } from '@/pages/Connections.jsx';
import { PRIMARY_BTN, GHOST_BTN } from './onboardingStyles.js';

// The OAuth callback returns the browser here (full-page load) with a
// ?meta_connected=1 or ?meta_error= flag, so the connect step is its own return
// target — a signed returnTo (see meta.js) brings us straight back to it.
const RETURN_TO = '/onboarding?step=connect';

// The callback redirects with a SPECIFIC failure code. Reporting all of them as
// "permissions weren't granted" told the user they refused something they never
// saw — server_error and project_not_found happen after consent was given.
const ERROR_MESSAGES = {
  denied:            'Meta permissions weren’t granted.',
  access_denied:     'Meta permissions weren’t granted.',
  server_error:      'Something went wrong on our end.',
  project_not_found: 'We couldn’t find your workspace.',
  invalid_state:     'The connection session expired.',
  // Not from the callback: the connect request itself never got us to Meta.
  start_failed:      'We couldn’t reach Meta to start the connection.',
};
const DEFAULT_ERROR = 'The connection didn’t complete.';

export function ConnectStep({ onConnected, onSkip }) {
  const { data } = useConnections();
  const { projectId, loading: projectLoading, refetch: refetchProject } = useProjectId();
  const [status, setStatus] = useState('idle'); // idle | connecting | failed
  const [errorCode, setErrorCode] = useState(null);

  // Return from OAuth: success advances, an error surfaces retry/skip.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('meta_connected') === '1') { onConnected(); return; }
    const err = params.get('meta_error');
    if (err) { setErrorCode(err); setStatus('failed'); }
  }, [onConnected]);

  // Already connected (re-entry, or a previous session's credential) → advance.
  useEffect(() => {
    if (data?.connections?.some((c) => c.connected)) onConnected();
  }, [data, onConnected]);

  const handleConnect = async () => {
    setStatus('connecting');
    setErrorCode(null);
    try {
      // Resolves true only once the redirect is actually under way. Previously
      // this was fired and forgotten: any failure rejected unhandled and the
      // button sat on "Redirecting to Meta…" with no error and no way back.
      const redirecting = await startConnect('META', projectId, RETURN_TO);
      if (!redirecting) { setErrorCode('start_failed'); setStatus('failed'); }
      // On success the browser is already navigating away — leave the button in
      // its 'connecting' state rather than flashing a failure during unload.
    } catch {
      setErrorCode('start_failed');
      setStatus('failed');
    }
  };

  if (status === 'failed') {
    return (
      <div>
        <h1 className="decision-title text-lumi-text mb-2">Connect wasn&apos;t completed.</h1>
        <p className="text-sm text-lumi-muted mb-6">
          {ERROR_MESSAGES[errorCode] ?? DEFAULT_ERROR}{' '}
          Try again, or continue and connect later from Settings.
        </p>
        <button
          type="button"
          onClick={() => { setErrorCode(null); setStatus('idle'); }}
          className={`${PRIMARY_BTN} mb-3`}
        >
          Try again
        </button>
        <button type="button" onClick={onSkip} className={GHOST_BTN}>
          Continue without connecting
        </button>
      </div>
    );
  }

  // No projectId AFTER the lookup settled: the connect call can't be built.
  // This used to render as a permanently disabled button with no explanation
  // and no escape — the skip route lives only on the failed screen.
  const projectUnavailable = !projectLoading && !projectId;

  return (
    <div>
      <h1 className="decision-title text-lumi-text mb-2">Connect your Meta account</h1>
      <p className="text-sm text-lumi-muted mb-6">
        Lumi scans your campaigns and delivers your first verdict in minutes.
      </p>
      <button
        type="button"
        onClick={handleConnect}
        disabled={status === 'connecting' || projectLoading || !projectId}
        className={`${PRIMARY_BTN} mb-3`}
      >
        {projectLoading
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Preparing…</>
          : status === 'connecting'
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Redirecting to Meta…</>
            : <>Connect Meta <ArrowRight className="w-4 h-4" strokeWidth={2} /></>}
      </button>

      {projectUnavailable ? (
        <>
          <p className="text-xs text-signal-kill text-center mb-3">
            We couldn&apos;t prepare the connection.{' '}
            <button type="button" onClick={refetchProject} className="underline font-medium">
              Retry
            </button>
          </p>
          <button type="button" onClick={onSkip} className={GHOST_BTN}>
            Continue without connecting
          </button>
        </>
      ) : (
        <p className="text-xs text-lumi-muted text-center inline-flex items-center justify-center gap-1.5 w-full">
          <ShieldCheck className="w-3.5 h-3.5" strokeWidth={1.5} /> OAuth · Read-only · No changes to your campaigns
        </p>
      )}
    </div>
  );
}

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

export function ConnectStep({ onConnected, onSkip }) {
  const { data } = useConnections();
  const { projectId } = useProjectId();
  const [status, setStatus] = useState('idle'); // idle | connecting | failed

  // Return from OAuth: success advances, an error surfaces retry/skip.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('meta_connected') === '1') { onConnected(); return; }
    if (params.get('meta_error')) setStatus('failed');
  }, [onConnected]);

  // Already connected (re-entry, or a previous session's credential) → advance.
  useEffect(() => {
    if (data?.connections?.some((c) => c.connected)) onConnected();
  }, [data, onConnected]);

  const handleConnect = () => {
    setStatus('connecting');
    startConnect('META', projectId, RETURN_TO); // full-page redirect — unmounts
  };

  if (status === 'failed') {
    return (
      <div>
        <h1 className="decision-title text-lumi-text mb-2">Connect wasn&apos;t completed.</h1>
        <p className="text-sm text-lumi-muted mb-6">
          Meta permissions weren&apos;t granted. Try again, or continue and connect later from Settings.
        </p>
        <button type="button" onClick={() => setStatus('idle')} className={`${PRIMARY_BTN} mb-3`}>
          Try again
        </button>
        <button type="button" onClick={onSkip} className={GHOST_BTN}>
          Continue without connecting
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="decision-title text-lumi-text mb-2">Connect your Meta account</h1>
      <p className="text-sm text-lumi-muted mb-6">
        Lumi scans your campaigns and delivers your first verdict in minutes.
      </p>
      <button
        type="button"
        onClick={handleConnect}
        disabled={status === 'connecting' || !projectId}
        className={`${PRIMARY_BTN} mb-3`}
      >
        {status === 'connecting'
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Redirecting to Meta…</>
          : <>Connect Meta <ArrowRight className="w-4 h-4" strokeWidth={2} /></>}
      </button>
      <p className="text-xs text-lumi-muted text-center inline-flex items-center justify-center gap-1.5 w-full">
        <ShieldCheck className="w-3.5 h-3.5" strokeWidth={1.5} /> OAuth · Read-only · No changes to your campaigns
      </p>
    </div>
  );
}

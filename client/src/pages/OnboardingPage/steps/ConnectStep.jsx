import { useEffect, useState, useRef } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { useConnections } from '@/hooks/useConnections.js';
import { useProjectId } from '@/hooks/useProjectId.js';
import { startConnect } from '@/features/connectors/startConnect.js';
import { PRIMARY_BTN, GHOST_BTN } from './onboardingStyles.js';
import { hasConfirmedMetaConnection, connectionRefusal, connectStartFailure } from './onboardingEvidence.js';

// The OAuth callback returns the browser here (full-page load) with a
// ?meta_connected=1 or ?meta_error= flag, so the connect step is its own return
// target — a signed returnTo (see meta.js) brings us straight back to it.
const RETURN_TO = '/onboarding?step=connect';

export function ConnectStep({ onConnected, onSkip, saving = false }) {
  const connectionRead = useConnections();
  const { data, loading: connectionLoading, error: connectionError, refetch: refetchConnections } = connectionRead;
  const { projectId, loading: projectLoading, refetch: refetchProject } = useProjectId();
  const callbackError = new URLSearchParams(window.location.search).get('meta_error');
  const callbackSuccess = new URLSearchParams(window.location.search).get('meta_connected') === '1';
  const [status, setStatus] = useState(callbackError ? 'failed' : 'idle');
  const [errorCode, setErrorCode] = useState(callbackError);
  const [checkingCallback, setCheckingCallback] = useState(callbackSuccess && !callbackError);
  const callbackRead = useRef({ requested: false, data: null, error: null });
  const notified = useRef(false);
  const readerEligible = useRef(!new URLSearchParams(window.location.search).has('meta_error'));
  const request = useRef({ id: 0, locked: false, active: true });
  useEffect(() => {
    request.current.active = true;
    const current = request.current;
    return () => { current.active = false; current.id += 1; };
  }, []);

  const refreshConnection = () => {
    if (saving || !request.current.active || typeof refetchConnections !== 'function') return;
    callbackRead.current = { requested: true, data, error: connectionError };
    setCheckingCallback(true);
    refetchConnections();
  };

  // Callback success requests verification; it is never credential evidence.
  // A new settled hook result must replace the exact pre-refresh data/error.
  useEffect(() => {
    if (saving || notified.current) return;
    if (callbackError) { setErrorCode(callbackError); setStatus('failed'); return; }
    if (callbackSuccess) {
      if (!callbackRead.current.requested) {
        callbackRead.current = { requested: true, data, error: connectionError };
        if (typeof refetchConnections === 'function') refetchConnections();
        return;
      }
      if (connectionLoading !== false || (data === callbackRead.current.data && connectionError === callbackRead.current.error)) return;
      setCheckingCallback(false);
    }
    if (readerEligible.current && status === 'idle' && hasConfirmedMetaConnection({ data, loading: connectionLoading, error: connectionError })) {
      notified.current = true;
      onConnected();
    }
  }, [data, connectionLoading, connectionError, refetchConnections, callbackError, callbackSuccess, onConnected, saving, status]);

  const handleConnect = async () => {
    if (saving || request.current.locked || notified.current) return;
    const id = ++request.current.id;
    request.current.locked = true;
    readerEligible.current = false;
    setStatus('connecting');
    setErrorCode(null);
    try {
      // Resolves true only once the redirect is actually under way. Previously
      // this was fired and forgotten: any failure rejected unhandled and the
      // button sat on "Redirecting to Meta…" with no error and no way back.
      const redirecting = await startConnect('META', projectId, RETURN_TO);
      if (!request.current.active || request.current.id !== id) return;
      if (!redirecting) { setErrorCode('start_failed'); setStatus('failed'); }
      if (!redirecting) request.current.locked = false;
      // On success the browser is already navigating away — leave the button in
      // its 'connecting' state rather than flashing a failure during unload.
    } catch (error) {
      if (!request.current.active || request.current.id !== id) return;
      request.current.locked = false;
      setErrorCode(connectStartFailure(error));
      setStatus('failed');
    }
  };

  if (status === 'failed') {
    const refusal = connectionRefusal(errorCode);
    return (
      <div data-lumi-env="product" className="bg-[var(--lumi-color-surface-base)]">
        <h1 className="decision-title text-[var(--lumi-color-text-claim)] mb-2">Connect wasn&apos;t completed.</h1>
        <p role="alert" className="text-[length:var(--lumi-type-body-default-size)] text-[var(--lumi-color-text-meta)] mb-6">
          {refusal.message}{' '}
          You can continue and review the connection later from Settings.
        </p>
        {refusal.retryable && <button
          type="button"
          disabled={saving}
          onClick={() => {
            const target = new URL(window.location.href);
            target.searchParams.delete('meta_error');
            target.searchParams.delete('meta_connected');
            window.history.replaceState({}, '', `${target.pathname}${target.search}${target.hash}`);
            setErrorCode(null); setStatus('idle');
          }}
          className={`${PRIMARY_BTN} mb-3`}
        >
          Try again
        </button>}
        <button type="button" onClick={onSkip} disabled={saving} className={GHOST_BTN}>
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
    <div data-lumi-env="product" className="bg-[var(--lumi-color-surface-base)]">
      <h1 className="decision-title text-[var(--lumi-color-text-claim)] mb-2">Connect your Meta account</h1>
      <p className="text-[length:var(--lumi-type-body-default-size)] text-[var(--lumi-color-text-meta)] mb-6">
        Lumi scans your campaigns and delivers your first verdict in minutes.
      </p>
      <button
        type="button"
        onClick={handleConnect}
        disabled={saving || checkingCallback || status === 'connecting' || projectLoading || !projectId}
        className={`${PRIMARY_BTN} mb-3`}
      >
        {checkingCallback
          ? 'Checking Meta connection…'
          : projectLoading
          ? 'Preparing…'
          : status === 'connecting'
            ? 'Redirecting to Meta…'
            : <>Connect Meta <ArrowRight className="w-4 h-4" strokeWidth={2} /></>}
      </button>

      {checkingCallback && <p role="status" className="text-[length:var(--lumi-type-body-default-size)] text-[var(--lumi-color-text-meta)] mb-3">Waiting for current connection evidence.</p>}
      {callbackSuccess && (checkingCallback || !hasConfirmedMetaConnection(connectionRead)) && (
        <div className="mb-3">
          {!checkingCallback && <p role="alert" className="text-[length:var(--lumi-type-body-default-size)] text-[var(--lumi-color-text-meta)] mb-3">
            {connectionError ? 'We couldn’t verify the Meta connection.' : !data?.workspaceId?.trim()
              ? 'Your workspace could not be confirmed for this connection.' : 'A current Meta connection has not been confirmed.'}
          </p>}
          {!checkingCallback && <button type="button" onClick={refreshConnection} disabled={saving || connectionLoading} className={`${PRIMARY_BTN} mb-3`}>Retry connection check</button>}
          <button type="button" onClick={onSkip} disabled={saving} className={GHOST_BTN}>Continue without connecting</button>
        </div>
      )}

      {projectUnavailable ? (
        <>
          <p className="text-[length:var(--lumi-type-caption-default-size)] text-[var(--lumi-color-state-failed-foreground)] text-center mb-3">
            We couldn&apos;t prepare the connection.{' '}
            <button type="button" onClick={refetchProject} disabled={saving} className="underline font-medium">
              Retry
            </button>
          </p>
          {!callbackSuccess && <button type="button" onClick={onSkip} disabled={saving} className={GHOST_BTN}>
            Continue without connecting
          </button>}
        </>
      ) : (
        <p className="text-[length:var(--lumi-type-caption-default-size)] text-[var(--lumi-color-text-meta)] text-center inline-flex items-center justify-center gap-1.5 w-full">
          <ShieldCheck className="w-3.5 h-3.5" strokeWidth={1.5} /> OAuth · Read-only · No changes to your campaigns
        </p>
      )}
    </div>
  );
}

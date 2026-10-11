import { CheckCircle2, ArrowRight } from 'lucide-react';
import { useConnectorVerdicts } from '@/hooks/useConnectorVerdicts.js';
import { useConnectorCampaigns } from '@/hooks/useConnectorCampaigns.js';
import { useConnections } from '@/hooks/useConnections.js';
import { PRIMARY_BTN } from './onboardingStyles.js';
import { hasConfirmedMetaConnection, readyEvidenceState } from './onboardingEvidence.js';

// The payoff of the whole flow: the verdict IS the page. The status counts are
// demoted to chips under the CTA.
//
// The verdict projection carries `signalType` + `recommendationTypes` but no
// prose `recommendation` field (yet). Prefer a backend-authored one the moment it
// exists; until then fall back to the verdict-level deterministic line — which is
// exactly the fallback the engine's own projection comment describes. Never the
// AI, never fabricated.
const RECOMMENDATION = {
  KILL:  'Pause this campaign today and move its budget to a stronger performer.',
  SCALE: 'Raise the budget or widen the audience — this campaign has room to grow.',
};

function Chip({ done, children }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${
        done
          ? 'border-signal-scale/30 text-signal-scale bg-signal-scale/5'
          : 'border-lumi-border text-lumi-muted'
      }`}
    >
      {done && <CheckCircle2 className="w-3 h-3" strokeWidth={2.5} />}
      {children}
    </span>
  );
}

// A pending read is waiting, not a preview of a verdict that has not arrived.
function PendingResults() {
  return (
    <div>
      <h1 className="decision-title text-lumi-text mb-2">Your results</h1>
      <p role="status" className="text-sm text-lumi-muted">Waiting for campaign and verdict results.</p>
    </div>
  );
}

export function ReadyStep({ onEnterApp }) {
  const { verdicts, status, gatedOut, loading: vLoading, error: verdictError } = useConnectorVerdicts();
  const { campaigns, loading: cLoading, error: campaignError } = useConnectorCampaigns();
  const connectionRead = useConnections();

  if (vLoading || cLoading) return <PendingResults />;

  // Neither cleared arrays nor retained data can certify a failed combined read.
  if (campaignError || verdictError) {
    return (
      <div>
        <div role="alert" className="mb-6">
          <h1 className="decision-title text-lumi-text mb-2">Your results couldn&apos;t be loaded.</h1>
          <p className="text-sm text-lumi-muted">
            Lumi couldn&apos;t read your campaigns and verdicts together. Open Campaigns to continue.
          </p>
        </div>
        <button type="button" onClick={onEnterApp} className={PRIMARY_BTN}>
          Open Campaigns
          <ArrowRight className="w-4 h-4" strokeWidth={2} />
        </button>
      </div>
    );
  }

  // Connection evidence is independent of the campaign/verdict population.
  const metaConnected = hasConfirmedMetaConnection(connectionRead);
  const evidence = readyEvidenceState(status, gatedOut);

  const total = campaigns.length;
  const scored = verdicts.length;

  // "First verdict" = the highest-stakes actionable call. There is no impact
  // score, so rank the KILL/SCALE verdicts by spend — the most money on the line
  // surfaces first.
  const topVerdict =
    [...verdicts]
      .filter((v) => v.verdict === 'KILL' || v.verdict === 'SCALE')
      .sort((a, b) => (b.spendMinor ?? 0) - (a.spendMinor ?? 0))[0] ?? null;

  const isKill = topVerdict?.verdict === 'KILL';
  const Heading = topVerdict ? 'h1' : 'p';

  return (
    <div>
      {/* lumi-gold is 1.34:1 on the light surface — the eyebrow reads as an
          eyebrow through size and tracking, not colour. */}
      <Heading className="text-[11px] font-semibold text-lumi-muted uppercase tracking-widest mb-4">
        {topVerdict ? 'Your first verdict' : 'Your results'}
      </Heading>

      {topVerdict ? (
        <div
          className={`rounded-2xl p-5 mb-5 border ${
            isKill ? 'bg-signal-kill/10 border-signal-kill/30' : 'bg-signal-scale/10 border-signal-scale/30'
          }`}
        >
          <p
            className={`text-4xl font-black tracking-tight mb-1 ${
              isKill ? 'text-signal-kill' : 'text-signal-scale'
            }`}
          >
            {topVerdict.verdict}
          </p>
          {topVerdict.confidence != null && (
            <p className="text-xs text-lumi-muted mb-4">
              {Math.round(topVerdict.confidence * 100)}% confidence
            </p>
          )}

          <p className="text-base font-bold text-lumi-text mb-2">{topVerdict.name}</p>
          {topVerdict.rationale && (
            <p className="text-sm text-lumi-muted leading-relaxed mb-4">{topVerdict.rationale}</p>
          )}

          <div className="border-t border-lumi-border pt-3">
            <p className="text-[10px] font-bold text-lumi-muted uppercase tracking-widest mb-1">
              Recommendation
            </p>
            <p className="text-sm font-medium text-lumi-text">
              {topVerdict.recommendation ?? RECOMMENDATION[topVerdict.verdict]}
            </p>
          </div>
        </div>
      ) : (
        <div className="mb-6">
          <h1 className="decision-title text-lumi-text mb-2">
            {evidence.heading}
          </h1>
          <p className="text-sm text-lumi-muted">
            {evidence.message}
          </p>
        </div>
      )}

      {topVerdict && status !== 'OK' && <p className="text-sm text-lumi-muted mb-4">{evidence.message}</p>}
      {evidence.gates.length > 0 && (
        <ul className="mb-6 space-y-3" aria-label="Campaign assessment prerequisites">
          {evidence.gates.map((gate, index) => (
            <li key={`${gate.row.id}-${index}`} data-assessment-state={gate.state} className="text-sm text-lumi-muted">
              <p className="font-medium text-lumi-text">{gate.row.name ?? gate.row.id}</p>
              <p>{gate.message}</p>
              {gate.prerequisite && <p>{gate.prerequisite}</p>}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onEnterApp}
        className={`${PRIMARY_BTN} mb-5`}
      >
        {scored > 0 ? 'See all verdicts' : 'Open Campaigns'}
        <ArrowRight className="w-4 h-4" strokeWidth={2} />
      </button>

      <div className="flex items-center justify-center gap-2 flex-wrap">
        {metaConnected && <Chip done>Meta</Chip>}
        {total > 0 && <Chip>{`${total} returned campaign${total === 1 ? '' : 's'}`}</Chip>}
        {scored > 0 && <Chip>{`${scored} returned verdict${scored === 1 ? '' : 's'}`}</Chip>}
      </div>
    </div>
  );
}

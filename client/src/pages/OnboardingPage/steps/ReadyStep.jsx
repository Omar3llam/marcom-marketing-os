import { CheckCircle2, ArrowRight } from 'lucide-react';
import { useConnectorVerdicts } from '@/hooks/useConnectorVerdicts.js';
import { useConnectorCampaigns } from '@/hooks/useConnectorCampaigns.js';
import { useConnections } from '@/hooks/useConnections.js';
import { PRIMARY_BTN } from './onboardingStyles.js';
import { hasConfirmedMetaConnection, readyEvidenceState } from './onboardingEvidence.js';

// Current assessment, not a recorded Decision (PR-1; Grammar §1–3). Only the
// supplied call, grounds, confidence and read-only recommendation appear. No
// Action/Outcome/Memory stage or unwindowed metric is manufactured. Published
// status/gates retain the P9-06 adapter; counts describe returned rows only.
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
      className="inline-flex items-center gap-1.5 font-mono text-[length:var(--lumi-type-caption-default-size)] text-[var(--lumi-color-text-meta)]"
    >
      {done && <CheckCircle2 className="w-3 h-3" strokeWidth={2.5} />}
      {children}
    </span>
  );
}

// A pending read is waiting, not a preview of a verdict that has not arrived.
function PendingResults() {
  return (
    <div data-lumi-env="product" className="bg-[var(--lumi-color-surface-base)]">
      <h1 className="decision-title text-[var(--lumi-color-text-claim)] mb-2">Your results</h1>
      <p role="status" className="text-[length:var(--lumi-type-body-default-size)] text-[var(--lumi-color-text-meta)]">Waiting for campaign and verdict results.</p>
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
      <div data-lumi-env="product" className="bg-[var(--lumi-color-surface-base)]">
        <div role="alert" className="mb-6">
          <h1 className="decision-title text-[var(--lumi-color-text-claim)] mb-2">Your results couldn&apos;t be loaded.</h1>
          <p className="text-[length:var(--lumi-type-body-default-size)] text-[var(--lumi-color-text-body)]">
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

  return (
    <div data-lumi-env="product" className="bg-[var(--lumi-color-surface-base)]">
      <p className="text-[length:var(--lumi-type-caption-default-size)] text-[var(--lumi-color-text-meta)] mb-4">
        {topVerdict ? 'Your first verdict' : 'Your results'}
      </p>

      {topVerdict ? (
        <section aria-label="Current campaign assessment" className="mb-8">
          <p className="text-[length:var(--lumi-type-caption-default-size)] text-[var(--lumi-color-text-meta)] mb-3">NOW · Current assessment</p>
          <h1 data-assessment-verdict className="font-body text-[length:var(--lumi-type-heading-surface-size)] leading-[var(--lumi-type-heading-surface-line-height)] font-semibold text-[var(--lumi-color-text-claim)] flex items-center gap-3 mb-4">
            <span data-verdict-mark aria-hidden="true" className={`w-1.5 h-6 shrink-0 ${isKill ? 'bg-[var(--lumi-color-verdict-kill-mark)]' : 'bg-[var(--lumi-color-verdict-scale-mark)]'}`} />
            {topVerdict.verdict}
          </h1>
          <p className="text-[length:var(--lumi-type-body-claim-size)] font-semibold text-[var(--lumi-color-text-claim)] mb-2 break-words">{topVerdict.name}</p>
          {topVerdict.confidence != null && (
            <p className="font-mono text-[length:var(--lumi-type-caption-default-size)] text-[var(--lumi-color-text-meta)] mb-6">
              <span>{Math.round(topVerdict.confidence * 100)}% confidence</span>{' · Published assessment'}
            </p>
          )}

          {topVerdict.rationale && (
            <div className="mb-6">
              <h2 className="text-[length:var(--lumi-type-caption-default-size)] text-[var(--lumi-color-text-meta)] mb-2">Reason</h2>
              <p className="text-[length:var(--lumi-type-body-default-size)] text-[var(--lumi-color-text-body)] leading-relaxed break-words">{topVerdict.rationale}</p>
            </div>
          )}

          <div className="border-t border-[var(--lumi-color-border-divider)] pt-4">
            <h2 className="text-[length:var(--lumi-type-caption-default-size)] text-[var(--lumi-color-text-meta)] mb-2">
              Recommendation
            </h2>
            <p className="text-[length:var(--lumi-type-body-default-size)] text-[var(--lumi-color-text-body)] break-words">
              {topVerdict.recommendation ?? RECOMMENDATION[topVerdict.verdict]}
            </p>
          </div>
        </section>
      ) : (
        <div className="mb-6">
          <h1 className="decision-title text-[var(--lumi-color-text-claim)] mb-2">
            {evidence.heading}
          </h1>
          <p className="text-[length:var(--lumi-type-body-default-size)] text-[var(--lumi-color-text-body)]">
            {evidence.message}
          </p>
        </div>
      )}

      {topVerdict && status !== 'OK' && <p className="text-[length:var(--lumi-type-body-default-size)] text-[var(--lumi-color-text-body)] mb-4">{evidence.message}</p>}
      {evidence.gates.length > 0 && (
        <ul className="mb-8 space-y-4 border-t border-[var(--lumi-color-border-divider)] pt-4" aria-label="Campaign assessment prerequisites">
          {evidence.gates.map((gate, index) => (
            <li key={`${gate.row.id}-${index}`} data-assessment-state={gate.state} className="text-[length:var(--lumi-type-body-default-size)] text-[var(--lumi-color-text-body)] break-words">
              <p className="font-medium text-[var(--lumi-color-text-claim)] mb-1">{gate.row.name ?? gate.row.id}</p>
              <p>{gate.message}</p>
              {gate.prerequisite && <p className="mt-2 text-[var(--lumi-color-text-meta)]">{gate.prerequisite}</p>}
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

      <div aria-label="Returned result scope" className="flex items-center gap-x-4 gap-y-2 flex-wrap">
        {metaConnected && <Chip done>Meta</Chip>}
        {total > 0 && <Chip>{`${total} returned campaign${total === 1 ? '' : 's'}`}</Chip>}
        {scored > 0 && <Chip>{`${scored} returned verdict${scored === 1 ? '' : 's'}`}</Chip>}
      </div>
    </div>
  );
}

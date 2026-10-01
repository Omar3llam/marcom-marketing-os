import { CheckCircle2, ArrowRight } from 'lucide-react';
import { useConnectorVerdicts } from '@/hooks/useConnectorVerdicts.js';
import { useConnectorCampaigns } from '@/hooks/useConnectorCampaigns.js';
import { useConnections } from '@/hooks/useConnections.js';
import { PRIMARY_BTN } from './onboardingStyles.js';

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

// Skeleton, not a spinner — it keeps the card's shape so the layout doesn't jump
// when the verdict lands.
function Skeleton() {
  return (
    <div>
      <div className="h-3 w-24 rounded bg-lumi-border/40 animate-pulse mb-4" />
      <div className="h-44 w-full rounded-2xl bg-lumi-border/20 animate-pulse mb-5" />
      <div className="h-11 w-full rounded-xl bg-lumi-border/20 animate-pulse" />
    </div>
  );
}

export function ReadyStep({ onEnterApp }) {
  const { verdicts, loading: vLoading, error: verdictError } = useConnectorVerdicts();
  const { campaigns, loading: cLoading, error: campaignError } = useConnectorCampaigns();
  const { data: connections, loading: connectionsLoading, error: connectionsError } = useConnections();

  if (vLoading || cLoading) return <Skeleton />;

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
  const metaConnected = !connectionsLoading && !connectionsError
    && connections?.connections?.some((connection) => connection.platform === 'META' && connection.connected === true);

  const total  = campaigns?.length ?? 0;
  const scored = verdicts?.length ?? 0;

  // "First verdict" = the highest-stakes actionable call. There is no impact
  // score, so rank the KILL/SCALE verdicts by spend — the most money on the line
  // surfaces first.
  const topVerdict =
    [...(verdicts ?? [])]
      .filter((v) => v.verdict === 'KILL' || v.verdict === 'SCALE')
      .sort((a, b) => (b.spendMinor ?? 0) - (a.spendMinor ?? 0))[0] ?? null;

  const isKill = topVerdict?.verdict === 'KILL';

  return (
    <div>
      {/* lumi-gold is 1.34:1 on the light surface — the eyebrow reads as an
          eyebrow through size and tracking, not colour. */}
      <p className="text-[11px] font-semibold text-lumi-muted uppercase tracking-widest mb-4">
        {topVerdict ? 'Your first verdict' : 'Analysis complete'}
      </p>

      {topVerdict ? (
        <div
          className={`rounded-2xl p-5 mb-5 border animate-verdict-enter ${
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
            {total > 0 ? 'No verdicts requiring immediate action.' : 'No campaigns found yet.'}
          </h1>
          <p className="text-sm text-lumi-muted">
            {total === 0
              ? 'Verdicts appear after your first sync.'
              : scored > 0
                ? `Lumi scored ${scored} campaign${scored === 1 ? '' : 's'} — none returned a kill or scale call.`
                : 'Verdicts appear once your campaigns have revenue data.'}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={onEnterApp}
        className={`${PRIMARY_BTN} mb-5 animate-fade-up-delay`}
      >
        {scored > 0 ? 'See all verdicts' : 'Open Campaigns'}
        <ArrowRight className="w-4 h-4" strokeWidth={2} />
      </button>

      <div className="flex items-center justify-center gap-2 flex-wrap animate-fade-up-late">
        {metaConnected && <Chip done>Meta</Chip>}
        <Chip done={total > 0}>{`${total} Campaign${total === 1 ? '' : 's'}`}</Chip>
        <Chip done={scored > 0}>{`${scored} Verdict${scored === 1 ? '' : 's'}`}</Chip>
      </div>
    </div>
  );
}

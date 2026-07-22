import { CheckCircle2, ArrowRight } from 'lucide-react';
import { VerdictBadge } from '@/components/primitives/signals/VerdictBadge.jsx';
import { useConnectorVerdicts } from '@/hooks/useConnectorVerdicts.js';
import { useConnectorCampaigns } from '@/hooks/useConnectorCampaigns.js';
import { PRIMARY_BTN } from './onboardingStyles.js';

// The payoff of the whole flow: lead with the verdict, not a status checklist.
// The next-action line is derived from the verdict itself — deterministic, never
// from the AI — and only KILL/SCALE reach it (topVerdict is filtered to those).
const RECOMMENDATION = {
  KILL:  'Pause this campaign today and move its budget to a stronger performer.',
  SCALE: 'Raise the budget or widen the audience — this campaign has room to grow.',
};

function Row({ ok, children }) {
  return (
    <div className="flex items-center gap-2.5">
      <CheckCircle2
        className={`w-4 h-4 flex-shrink-0 ${ok ? 'text-signal-scale' : 'text-lumi-muted'}`}
        strokeWidth={2}
      />
      <span className="text-sm text-lumi-muted">{children}</span>
    </div>
  );
}

// Skeleton, not a spinner — it keeps the card's shape so the layout doesn't jump
// when the verdict lands.
function Skeleton() {
  return (
    <div>
      <div className="h-3 w-24 rounded bg-lumi-border/40 animate-pulse mb-3" />
      <div className="h-7 w-56 rounded bg-lumi-border/40 animate-pulse mb-6" />
      <div className="h-40 w-full rounded-xl bg-lumi-border/20 animate-pulse mb-6" />
      <div className="h-11 w-full rounded-xl bg-lumi-border/20 animate-pulse" />
    </div>
  );
}

export function ReadyStep({ onEnterApp }) {
  const { verdicts, loading: vLoading } = useConnectorVerdicts();
  const { campaigns, loading: cLoading } = useConnectorCampaigns();

  if (vLoading || cLoading) return <Skeleton />;

  const total  = campaigns?.length ?? 0;
  const scored = verdicts?.length ?? 0;

  // "First verdict" = the highest-stakes actionable call. There is no impact
  // score, so rank the KILL/SCALE verdicts by spend — the most money on the line
  // surfaces first.
  const topVerdict =
    [...(verdicts ?? [])]
      .filter((v) => v.verdict === 'KILL' || v.verdict === 'SCALE')
      .sort((a, b) => (b.spendMinor ?? 0) - (a.spendMinor ?? 0))[0] ?? null;

  // ---- Verdict-first outcome ------------------------------------------------
  if (topVerdict) {
    const isKill = topVerdict.verdict === 'KILL';
    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-lumi-gold mb-2">
          Verdict ready
        </p>
        <h1 className="decision-title text-lumi-text mb-6">Your first verdict is ready.</h1>

        <div
          className={`rounded-xl border p-4 mb-6 ${
            isKill
              ? 'border-signal-kill/30 bg-signal-kill/10'
              : 'border-signal-scale/30 bg-signal-scale/10'
          }`}
        >
          <div className="flex items-center justify-between gap-3 mb-3">
            <VerdictBadge verdict={topVerdict.verdict} />
            {topVerdict.confidence != null && (
              <span className="text-sm font-semibold text-lumi-text whitespace-nowrap">
                {Math.round(topVerdict.confidence * 100)}% confidence
              </span>
            )}
          </div>

          <p className="text-sm font-semibold text-lumi-text mb-1">{topVerdict.name}</p>
          {topVerdict.rationale && (
            <p className="text-sm text-lumi-muted leading-relaxed mb-3">{topVerdict.rationale}</p>
          )}

          <div className="border-t border-lumi-border pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-lumi-muted mb-1">
              Recommendation
            </p>
            <p className="text-sm text-lumi-text">{RECOMMENDATION[topVerdict.verdict]}</p>
          </div>
        </div>

        {/* Secondary: what the sync actually looked at */}
        <div className="border-t border-lumi-border pt-4 mb-8">
          <p className="text-xs font-semibold uppercase tracking-wide text-lumi-muted mb-3">
            What Lumi analyzed
          </p>
          <div className="space-y-2.5">
            <Row ok>Meta connected</Row>
            <Row ok={total > 0}>{`${total} campaign${total === 1 ? '' : 's'} analyzed`}</Row>
            <Row ok>{`${scored} verdict${scored === 1 ? '' : 's'} generated`}</Row>
          </div>
        </div>

        <button type="button" onClick={onEnterApp} className={PRIMARY_BTN}>
          See all verdicts <ArrowRight className="w-4 h-4" strokeWidth={2} />
        </button>
      </div>
    );
  }

  // ---- No actionable verdict: honest, distinct layout -----------------------
  const heading = total > 0 ? 'No campaigns need action yet.' : 'No campaigns found yet.';
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-lumi-gold mb-2">
        Analysis complete
      </p>
      <h1 className="decision-title text-lumi-text mb-2">{heading}</h1>
      <p className="text-sm text-lumi-muted mb-8">
        {total > 0
          ? 'Every campaign is holding steady — nothing to kill or scale right now.'
          : 'Once campaigns sync, Lumi scores each one and tells you what to do next.'}
      </p>

      <div className="space-y-3 mb-8">
        <Row ok>Meta connected</Row>
        <Row ok={total > 0}>
          {total > 0
            ? `${total} campaign${total === 1 ? '' : 's'} analyzed`
            : 'No campaigns found yet'}
        </Row>
        <Row ok={scored > 0}>
          {scored > 0
            ? `${scored} verdict${scored === 1 ? '' : 's'} generated`
            : 'Verdicts appear once campaigns have revenue data'}
        </Row>
      </div>

      <button type="button" onClick={onEnterApp} className={PRIMARY_BTN}>
        {scored > 0 ? 'See all verdicts' : 'Open Campaigns'}{' '}
        <ArrowRight className="w-4 h-4" strokeWidth={2} />
      </button>
    </div>
  );
}

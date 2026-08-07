// ============================================================
// MARCOM / Lumi — ExecutionContext  (Campaigns · under an expanded ad-set list)
// ------------------------------------------------------------
// The bridge between "this campaign is losing money" and "here is where to put
// your hands". Renders ONLY under a KILL or REALLOCATE campaign, and only when
// one of its ad sets is measurably dragging on the campaign's own CTR.
//
// Deliberately framed as WHERE TO LOOK, not WHAT IS WRONG. A low CTR is a
// symptom with many causes — a learning phase, a deliberate broad test, a
// seasonal audience — and none of them are visible in a MetricSnapshot. So the
// header says "Where to execute", the pick says "Execute here", and the
// action says "inspect", with pausing offered as a conditional the marketer
// resolves. Naming a root cause from two ratios would be a guess wearing a
// verdict's clothes.
//
// Presentational: every figure comes from executionContext.js arithmetic over
// real snapshot fields. Silent (null) whenever the data cannot support a pick.
// ============================================================
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  ACTIONABLE_VERDICTS,
  spendConcentration,
  formatGap,
  gapMagnitude,
  buildEvidenceBullets,
  buildHypothesis,
} from './executionContext.js';
import { formatCurrency } from '@/lib/money';
import { useDecisionLearning } from '@/hooks/useDecisionLearning.js';
import { LearningInsight } from './LearningInsight.jsx';

const Label = ({ children }) => (
  <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-lumi-muted">{children}</p>
);

/**
 * @param {object}   props
 * @param {object}   props.campaign  — the campaign row (ctr/spendMinor baseline)
 * @param {object}   props.evidence  — analyzeEvidence's result from useEvidence.
 *   THE ranking. `summary.bottom` is the ad set to inspect: a toAdSetRow carrying
 *   the same fields, in the same units, that the local ranker used to produce.
 * @param {string}   props.verdict
 * @param {Function} [props.onExecute]
 * @param {Function} [props.onDismiss]
 * @param {?string}  [props.executionState] — null | 'executing' | 'executed'
 *   | 'dismissing' | 'dismissed' | 'stale' | 'error'
 */
export function ExecutionContext({
  campaign, evidence, verdict,
  onExecute = null, onDismiss = null, executionState = null,
}) {
  // Above the early returns — hooks cannot sit after a conditional return. The
  // hook no-ops on a null entityId, so a row that renders nothing fetches
  // nothing either.
  const learning = useDecisionLearning(campaign?.entityId ?? null);

  if (!campaign || !ACTIONABLE_VERDICTS.includes(verdict)) return null;

  // The server's ranking is the only ranking. This component renders the row it
  // was handed and never derives its own — a second ranker here could name a
  // different ad set than the engine scored, and the two would part the moment
  // either side's thresholds moved. The gate that mounts this panel and the pick
  // inside it come from the same answer.
  const worst = evidence?.summary?.bottom ?? null;
  if (!worst) return null;

  const gap = formatGap(worst.ctr, campaign.ctr);
  const magnitude = gapMagnitude(worst.ctr, campaign.ctr);
  const share = spendConcentration(worst.spendMinor, campaign.spendMinor);
  const hypothesis = buildHypothesis(worst);

  // "Compared against N" — how strong the pick is, from the set the SERVER
  // actually ranked. `ranked` is the cohort after its rankability filter, so N
  // is smaller than the old local count (which took any non-null CTR) and the
  // claim errs downward: every row in it does report a CTR, and some rows too
  // thin to compare are no longer counted as though they had been.
  const bullets = buildEvidenceBullets(
    { ...worst, comparedCount: evidence.ranked?.length ?? 0 },
    campaign.ctr,
    campaign.spendMinor,
  );

  return (
    <div className="mt-2 rounded-lg border border-lumi-border bg-lumi-surface p-4">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-lumi-accent">
        Where to execute
      </p>

      {/* The pick. "Focus here first" — a place to start looking, not a culprit. */}
      <div className="mb-3">
        <Label>Execute here</Label>
        <p className="font-display text-sm font-semibold text-lumi-text">{worst.name}</p>
        <p className="mt-0.5 font-mono text-[11px] text-lumi-subtle">AD SET · {worst.channel}</p>
      </div>

      {/* Why this one and not another. Evidence, not narrative. */}
      {bullets.length > 0 && (
        <div className="mb-3">
          <Label>Selected because</Label>
          <ul className="space-y-1">
            {bullets.map((b) => (
              <li key={b} className="flex gap-2 text-xs text-lumi-text">
                <span className="mt-0.5 text-lumi-subtle">·</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The two figures the pick rests on. "—" when unreported, never 0. */}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <Label>CTR</Label>
          <p className="font-mono text-sm tabular-nums text-signal-kill">
            {(worst.ctr * 100).toFixed(2)}%
          </p>
          {gap && <p className="font-mono text-[10px] text-signal-kill">{gap}</p>}
        </div>
        <div>
          <Label>Spend</Label>
          <p className="font-mono text-sm tabular-nums text-lumi-text">
            {worst.spendMinor != null
              ? formatCurrency(worst.spendMinor, worst.currency)
              : <span className="text-lumi-subtle" title="No data">—</span>}
          </p>
          {share != null && (
            <p className="font-mono text-[10px] text-lumi-muted">
              {Math.round(share * 100)}% of campaign
            </p>
          )}
        </div>
      </div>

      {/* A hypothesis, kept visibly apart from the evidence above it. "Observed"
          is checkable arithmetic; "Interpretation" is hedged on purpose, because
          the same two ratios are produced by a learning phase, a deliberate
          broad test and a genuinely tired creative alike. Collapsing the two
          into one confident sentence is the failure this split exists to
          prevent. Absent entirely when the data cannot support one. */}
      {hypothesis && (
        <div className="mb-3 border-t border-lumi-border pt-3">
          <Label>Working hypothesis</Label>
          <p className="mb-2 text-xs font-semibold text-lumi-text">{hypothesis.label}</p>

          <Label>Observed</Label>
          <p className="mb-2 text-xs leading-relaxed text-lumi-text">{hypothesis.observed}</p>

          <Label>Interpretation</Label>
          <p className="mb-2 text-xs leading-relaxed text-lumi-muted">{hypothesis.interpretation}</p>

          <p className="text-[11px] italic leading-relaxed text-lumi-muted">{hypothesis.caveat}</p>
        </div>
      )}

      {/* The ask. Inspect is something the marketer can always safely do; pause
          is offered as a conditional they resolve, because the data cannot see
          a learning phase or a deliberate test. */}
      <div className="rounded-lg bg-lumi-elevated px-3 py-2.5">
        <Label>Recommended action</Label>
        <p className="text-xs leading-relaxed text-lumi-text">
          Inspect <span className="font-semibold">{worst.name}</span> first — its CTR is{' '}
          <span className="text-signal-kill">{magnitude}%</span> below the campaign rate.
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-lumi-muted">
          If no test or learning phase explains the gap, consider pausing it.
        </p>

        {/* The workspace's own track record for decisions like this one. Absent
            entirely below a defensible sample — silence, never "0 of 2". */}
        <LearningInsight learning={learning} />
      </div>

      {/* ── What the operator did about it ────────────────────────────────
          The only way a verdict ever becomes a scored prediction. Everything
          above this line is the product talking; this is the product listening.

          ONE-WAY. Every terminal state replaces the buttons rather than
          disabling them: a clickable-looking control that has already been
          answered invites a second click, and a second click on a recorded
          claim is not a second claim. `stale` and the two error branches are
          terminal for the same reason — none of them get better by retrying
          the same request. */}
      {onExecute && onDismiss && (
        <div className="mt-3 border-t border-lumi-border pt-3">
          {executionState === null && (
            <>
              <Label>Did you act on this?</Label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onExecute}
                  className="rounded-lg bg-signal-kill px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                >
                  I executed this
                </button>
                <button
                  type="button"
                  onClick={onDismiss}
                  className="rounded-lg border border-lumi-border px-3 py-1.5 text-xs text-lumi-subtle transition-colors hover:text-lumi-text"
                >
                  Not applicable
                </button>
              </div>
              {/* Says what the answer is FOR. Without it the pair reads as a
                  satisfaction survey, and "Not applicable" looks like a way to
                  hide the row rather than a recorded judgement. */}
              <p className="mt-2 text-[11px] leading-relaxed text-lumi-muted">
                Either answer is recorded — it is how Lumi learns whether its calls were right.
              </p>
            </>
          )}

          {(executionState === 'executing' || executionState === 'dismissing') && (
            <p className="flex items-center gap-1.5 font-mono text-[11px] text-lumi-subtle">
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} /> Recording…
            </p>
          )}

          {executionState === 'executed' && (
            <p className="flex items-center gap-1.5 font-mono text-[11px] text-signal-scale">
              <CheckCircle2 className="h-3 w-3" strokeWidth={2} /> Recorded as executed
            </p>
          )}

          {executionState === 'dismissed' && (
            <p className="font-mono text-[11px] text-lumi-subtle">Recorded as not applicable</p>
          )}

          {/* The verdict was replaced between render and click. Not a failure and
              not retryable — the call they answered no longer exists, and saying
              "try again" would send them at a request that 404s forever. */}
          {executionState === 'stale' && (
            <p className="flex items-center gap-1.5 font-mono text-[11px] text-lumi-subtle">
              <AlertTriangle className="h-3 w-3" strokeWidth={2} /> This verdict was replaced — refresh to see the current one
            </p>
          )}

          {executionState === 'error' && (
            <p className="flex items-center gap-1.5 font-mono text-[11px] text-trend-danger">
              <AlertTriangle className="h-3 w-3" strokeWidth={2} /> Couldn&apos;t record — refresh and try again
            </p>
          )}
        </div>
      )}
    </div>
  );
}

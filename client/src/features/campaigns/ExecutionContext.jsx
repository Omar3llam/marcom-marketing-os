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
// header says "Where to execute", the pick says "Focus here first", and the
// action says "inspect", with pausing offered as a conditional the marketer
// resolves. Naming a root cause from two ratios would be a guess wearing a
// verdict's clothes.
//
// Presentational: every figure comes from executionContext.js arithmetic over
// real snapshot fields. Silent (null) whenever the data cannot support a pick.
// ============================================================
import {
  ACTIONABLE_VERDICTS,
  findWorstAdSet,
  spendConcentration,
  formatGap,
  gapMagnitude,
  buildEvidenceBullets,
  buildHypothesis,
} from './executionContext.js';
import { formatCurrency } from '@/lib/money';

const Label = ({ children }) => (
  <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-lumi-muted">{children}</p>
);

export function ExecutionContext({ campaign, adSets, verdict }) {
  if (!campaign || !ACTIONABLE_VERDICTS.includes(verdict)) return null;

  const worst = findWorstAdSet(adSets, campaign.ctr);
  if (!worst) return null;

  const gap = formatGap(worst.ctr, campaign.ctr);
  const magnitude = gapMagnitude(worst.ctr, campaign.ctr);
  const share = spendConcentration(worst.spendMinor, campaign.spendMinor);
  const bullets = buildEvidenceBullets(worst, campaign.ctr, campaign.spendMinor);
  const hypothesis = buildHypothesis(worst);

  return (
    <div className="mt-2 rounded-lg border border-lumi-border bg-lumi-surface p-4">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-lumi-accent">
        Where to execute
      </p>

      {/* The pick. "Focus here first" — a place to start looking, not a culprit. */}
      <div className="mb-3">
        <Label>Start here</Label>
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
      </div>
    </div>
  );
}

// ============================================================
// MARCOM / Lumi — OutcomeEvidence (B5-01X' · what Lumi observed)
// GRAMMAR OBJECT Supporting OUTCOME EVIDENCE / MEASUREMENT.
// CONTRACT OutcomeEvidenceResponseSchema; each amount owns its denomination.
// STATES MEASURABLE, NOT_OBSERVED, AMBIGUOUS, NOT_MEASURABLE,
// INSUFFICIENT_COVERAGE, UNSUPPORTED, UNAVAILABLE; request loading/error.
// WHY LUMI Separates observed before/after evidence from the operator's
// judgement, including the limits of what Lumi can truthfully compare.
// ------------------------------------------------------------
// Sits ABOVE the operator's existing outcome fields and fills none of them. It
// reports Lumi's own daily observations either side of the intervention and
// says, in every state, exactly how much it does not know.
//
// THE COPY RULE. Every sentence here is observational. "Observed spend fell by
// X" is allowed; "the decision reduced spend" is not, and neither is anything
// that reads as a verdict on the operator's behalf. Lumi measured a change; it
// did not establish that the change was caused by the decision, and the person
// about to record an outcome is the one who brings that judgement.
//
// AND IT NEVER PRINTS A ZERO IT DID NOT MEASURE. A missing day, an unsupported
// channel and a failed read are three different sentences, none of which is
// "0.00" — that number would say the campaign delivered nothing.
// ============================================================
import { Eye } from 'lucide-react';
import { useOutcomeEvidence } from '@/hooks/useOutcomeEvidence.js';
import { formatCurrency } from '@/lib/money.ts';
import { isKnownCurrency } from '@/lib/monetaryCurrency.js';

const box = 'mt-3 rounded-xl border border-lumi-border/60 bg-lumi-surface p-3';
const note = 'text-sm text-lumi-muted';

/** A window's date range, stated plainly. ISO dates, so nothing is ambiguous. */
const range = (w) => (w?.days?.length ? `${w.days[0]} → ${w.days[w.days.length - 1]}` : '—');

function Shell({ children, title }) {
  return (
    <div className={box}>
      <div className="mb-2 flex items-center gap-2">
        <Eye className="h-3.5 w-3.5 text-lumi-accent" strokeWidth={1.5} />
        <span className="text-sm font-medium text-lumi-text">{title}</span>
      </div>
      {children}
    </div>
  );
}

/** The three-column comparison. `delta` is omitted entirely when incomplete. */
function Comparison({ evidence, showDelta }) {
  const { baseline, observation, delta } = evidence;
  const denomination = (side) => isKnownCurrency(side?.currency) && side?.currencyProvenance === 'PLATFORM_REPORTED';
  const known = (value) => typeof value === 'number' && Number.isFinite(value);
  // A formatter's default denomination must never label observed evidence.
  // Each cell reads its own published unit, including incomplete windows.
  const money = (side, key) => denomination(side) && known(side[key]) ? formatCurrency(side[key], side.currency) : '—';
  const ratio = (side, signed = false) => denomination(side) && known(side.roas)
    ? `${signed && side.roas > 0 ? '+' : ''}${side.roas.toFixed(2)}` : '—';

  const rows = [
    ['Spend', money(baseline, 'spendMinor'), money(observation, 'spendMinor'), money(delta, 'spendMinor')],
    ['Revenue', money(baseline, 'revenueMinor'), money(observation, 'revenueMinor'), money(delta, 'revenueMinor')],
    ['ROAS', ratio(baseline), ratio(observation), ratio(delta, true)],
  ];

  return (
    <>
      <section aria-label="Observed performance records" className="sm:hidden">
        {rows.map(([label, before, after, change]) => (
          <article key={label} aria-label={`${label} evidence`} className="mt-3 border-t border-lumi-border/40 pt-2 text-sm">
            <h4 className="font-medium text-lumi-text">{label}</h4>
            <dl className="mt-2 space-y-2">
              <div><dt className="text-lumi-muted">Before · {range(baseline)}</dt><dd className="tabular-nums text-lumi-text">{before}</dd></div>
              <div><dt className="text-lumi-muted">After · {range(observation)}</dt><dd className="tabular-nums text-lumi-text">{after}</dd></div>
              {showDelta && <div><dt className="text-lumi-muted">Observed change</dt><dd className="tabular-nums text-lumi-text">{change}</dd></div>}
            </dl>
          </article>
        ))}
      </section>
      <table className="hidden w-full text-sm tabular-nums sm:table">
        <caption className="sr-only">Observed performance comparison</caption>
        <thead>
          <tr className="text-lumi-muted">
            <th scope="col" className="py-1 text-left font-normal">Metric</th>
            <th scope="col" className="py-1 text-right font-normal">Before<br />{range(baseline)}</th>
            <th scope="col" className="py-1 text-right font-normal">After<br />{range(observation)}</th>
            {showDelta && <th scope="col" className="py-1 text-right font-normal">Observed change</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, before, after, change]) => (
            <tr key={label} className="border-t border-lumi-border/40">
              <th scope="row" className="py-1 text-left font-normal text-lumi-muted">{label}</th>
              <td className="py-1 text-right text-lumi-text">{before}</td>
              <td className="py-1 text-right text-lumi-text">{after}</td>
              {showDelta && <td className="py-1 text-right text-lumi-text">{change}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** How complete a window was, and which exact days are absent. */
function Coverage({ label, window: w }) {
  if (!w) return null;
  const { observed, required, missing } = w.coverage;
  return (
    <p className={note}>
      {label}: observed {observed} of {required} required days
      {missing.length > 0 && <> · missing {missing.join(', ')}</>}
    </p>
  );
}

const UNSUPPORTED_COPY = {
  LEVEL_NOT_INGESTED:
    'Lumi records daily observations at campaign level only, so it can’t measure this decision automatically yet.',
  CHANNEL_HAS_NO_DAILY_CAPABILITY:
    'Lumi doesn’t collect daily observations for this channel yet, so it has no evidence population to compare.',
  ENTITY_NOT_IN_GRAPH:
    'Lumi can’t tell which channel this entity belongs to, so it can’t choose an evidence source to read.',
};

export default function OutcomeEvidence({ decisionId }) {
  const { evidence, loading, error } = useOutcomeEvidence(decisionId);

  if (loading) return <div className={box}><p className={note}>Reading what Lumi observed…</p></div>;
  // A transport failure is the same class of fact as a failed evidence read: we
  // could not look. It is never rendered as an absence of performance.
  if (error || !evidence) {
    return (
      <Shell title="Evidence could not be read">
        <p className={note}>Nothing is shown here rather than a zero. Your own numbers below are unaffected.</p>
      </Shell>
    );
  }

  const { status, reason, baseline, observation, policy } = evidence;
  const windowNote = (
    <p className={`${note} mt-2`}>
      {policy.comparisonWindowDays} days before the intervention compared with {policy.comparisonWindowDays} days
      after it. {evidence.interventionDay} itself is in neither window.
    </p>
  );

  if (status === 'MEASURABLE') {
    return (
      <Shell title="What Lumi observed">
        <Comparison evidence={evidence} showDelta />
        {windowNote}
        <p className={`${note} mt-1`}>
          This is a measured change over those two windows — not a finding that the decision caused it.
        </p>
      </Shell>
    );
  }

  if (status === 'INSUFFICIENT_COVERAGE') {
    return (
      <Shell title="Comparison unavailable — incomplete evidence">
        <Coverage label="Before" window={baseline} />
        <Coverage label="After" window={observation} />
        <p className={`${note} mt-2`}>
          Lumi won’t show a change derived from a partial window. What it did observe is below.
        </p>
        <Comparison evidence={evidence} showDelta={false} />
      </Shell>
    );
  }

  if (status === 'UNSUPPORTED') {
    return (
      <Shell title="Lumi can’t measure this one automatically">
        <p className={note}>{UNSUPPORTED_COPY[reason] ?? UNSUPPORTED_COPY.CHANNEL_HAS_NO_DAILY_CAPABILITY}</p>
        <p className={`${note} mt-1`}>That’s a limit of what Lumi collects — not a statement about this campaign.</p>
      </Shell>
    );
  }

  if (status === 'NOT_OBSERVED') {
    return (
      <Shell title="No usable evidence was observed">
        <p className={note}>
          Lumi can read daily observations for this campaign but holds none across the compared windows.
        </p>
        <Coverage label="Before" window={baseline} />
        <Coverage label="After" window={observation} />
        {windowNote}
      </Shell>
    );
  }

  if (status === 'AMBIGUOUS') {
    return (
      <Shell title="Evidence couldn’t be reconciled">
        <p className={note}>
          Two readings of the same day disagree and nothing ranks them, so Lumi won’t pick one.
        </p>
      </Shell>
    );
  }

  // B5-01Y — THE READ FAILED. Distinct from every state above and from the
  // transport branch at the top, and it must never be confused with any of them.
  //
  // `readOutcomeEvidence` catches a failed evidence read and RETURNS a refusal,
  // so this arrives as HTTP 200 with a perfectly valid payload — `error` is null
  // and the guard above does not fire. Before this branch existed the status
  // matched nothing and fell through to NOT_MEASURABLE, which told the operator
  // Lumi "holds observations either side of the intervention". It holds none. It
  // never managed to look.
  //
  // No number is printed, deliberately. The policy windows ARE known here — they
  // are computed before the read is attempted — and showing them would imply
  // Lumi examined those days.
  if (status === 'UNAVAILABLE') {
    return (
      <Shell title="Evidence unavailable">
        <p className={note}>
          Lumi couldn’t read the observations needed to evaluate this outcome.
        </p>
        <p className={`${note} mt-1`}>
          Nothing was concluded from the failed read, and your own numbers below are unaffected.
        </p>
      </Shell>
    );
  }

  // NOT_MEASURABLE — the comparability contract refused the two windows. This
  // says the observations WERE read and found incompatible, so it is now an
  // explicit branch rather than the fallback: a state that makes a positive
  // claim about what Lumi holds must never be what an unhandled status inherits.
  if (status === 'NOT_MEASURABLE') {
    return (
      <Shell title="These observations can’t be compared">
        <p className={note}>
          {reason === 'MONETARY_BASIS_UNAVAILABLE'
            ? 'Lumi observed both windows, but their monetary values do not share one authoritative denomination, so it won’t calculate a before/after monetary comparison.'
            : <>Lumi holds observations either side of the intervention but they don’t describe one comparable subject
              {reason ? ` (${reason.toLowerCase().replace(/_/g, ' ')})` : ''}.</>}
        </p>
      </Shell>
    );
  }

  // A status this component does not recognise. Unreachable while the response
  // schema's enum and the branches above agree — which is exactly the pair that
  // drifted apart to produce B5-01Y, when a status the contract already carried
  // had no branch here. It claims nothing about what Lumi holds.
  return (
    <Shell title="Evidence couldn’t be established">
      <p className={note}>Lumi couldn’t establish evidence for this decision, and drew no conclusion.</p>
    </Shell>
  );
}

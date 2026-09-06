// ============================================================
// THE THEN DESTINATION — /app/decisions (B7 R-N1 + R-N2, B8-03)
// ------------------------------------------------------------
// What Lumi has decided, newest first. THEN is historical commitment: this
// surface answers "what did Lumi decide?", where Attention answers "what needs
// me now?" and Campaigns answers "what are we investigating?".
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
// · No row links to a detail page. `/app/decisions/:id` does not exist yet, and
//   a link to it would be the UI promising a capability the destination lacks —
//   one of B8-01's seven forbidden inferences. Rows become links in the slice
//   that builds the detail surface, not before.
// · No filters, no sort control. Ordering is the CLOCK and only the clock
//   (B7 R-N2); any other ordering is new product meaning and needs a ruling.
// · No confidence figure on a GUARDRAIL row. L-4: the column is called
//   `confidence` for all writers, but only Signal DERIVES it — a guardrail's
//   0.9 is a constant, and rendering it as a percentage is a constant dressed
//   as a measurement.
// ============================================================
import { Link } from 'react-router-dom';
import { History, AlertTriangle, Loader2 } from 'lucide-react';
import { PageHeader } from '@/design-system/patterns/index.js';
import { appRoutes } from '@/app/routeManifest.js';
import { useDecisionHistory } from '@/hooks/useDecisionHistory.js';

const CLASS_LABEL = { SIGNAL: 'Signal', GUARDRAIL: 'Guardrail' };

const fmtDate = (d) => new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: 'numeric',
}).format(d instanceof Date ? d : new Date(d));

/** The status a closed decision ended in, in the operator's words. */
const STATUS_COPY = {
  PROPOSED:   'Open',
  EXECUTED:   'You executed it',
  DISMISSED:  'You dismissed it',
  SUPERSEDED: 'Replaced by a later call',
  RESOLVED:   'The condition ended',
};

function DecisionRow({ d }) {
  // L-4 — a measurement only where it IS one.
  const showsConfidence = d.decisionClass === 'SIGNAL' && Number.isFinite(d.confidence);

  return (
    <li className="border-b border-lumi-border last:border-0 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-display font-semibold text-sm text-lumi-text">{d.verdict}</span>
            {d.decisionClass && (
              <span className="text-[11px] uppercase tracking-wide text-lumi-muted border border-lumi-border rounded px-1.5 py-0.5">
                {CLASS_LABEL[d.decisionClass] ?? d.decisionClass}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-lumi-muted break-words">{d.diagnosis}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs text-lumi-muted">{fmtDate(d.createdAt)}</div>
          <div className="text-xs text-lumi-subtle mt-0.5">{STATUS_COPY[d.status] ?? d.status}</div>
          {showsConfidence && (
            <div className="text-xs text-lumi-muted mt-0.5 tabular-nums">
              {Math.round(d.confidence * 100)}% confidence
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

export default function DecisionHistoryView() {
  const { decisions, total, hasMore, isLoading, error, loadMore } = useDecisionHistory();

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Decisions"
        description="What Lumi has decided, newest first."
      />

      {/* Absence is a MEASURED state (B8-02). Three different answers, never
          collapsed into one empty list. */}
      {isLoading && decisions.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-lumi-muted py-10">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
          Loading decisions…
        </div>
      )}

      {error && (
        <section className="rounded-xl border border-signal-hold/30 bg-lumi-surface p-6">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-signal-hold" strokeWidth={1.5} />
            <h2 className="font-display text-sm font-semibold text-lumi-text">
              Lumi couldn’t read this history just now.
            </h2>
          </div>
          <p className="mt-2 text-sm text-lumi-muted">
            This is a problem on our side. It is not a statement about how many
            decisions this account has.
          </p>
        </section>
      )}

      {!error && !isLoading && decisions.length === 0 && (
        <section className="rounded-xl border border-lumi-border bg-lumi-surface p-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-lumi-border">
            <History className="h-5 w-5 text-lumi-muted" strokeWidth={1.5} />
          </div>
          <h2 className="font-display text-sm font-semibold text-lumi-text">
            Lumi hasn’t decided anything here yet.
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-lumi-muted">
            Decisions appear once a sweep has judged a campaign. You can watch
            what needs you now on{' '}
            <Link to={appRoutes.overview} className="underline">Attention</Link>.
          </p>
        </section>
      )}

      {decisions.length > 0 && (
        <>
          <ul className="mt-2">
            {decisions.map((d) => <DecisionRow key={d.id} d={d} />)}
          </ul>

          {/* A capped list is not a capped count (B8-01). The page says how many
              it carries AND how many exist, so neither number implies the other. */}
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-lumi-muted tabular-nums">
              {total === null
                ? `Showing ${decisions.length}`
                : `Showing ${decisions.length} of ${total}`}
            </p>
            {hasMore && (
              <button
                type="button"
                onClick={loadMore}
                disabled={isLoading}
                className="text-sm font-display font-semibold text-lumi-accent disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-lumi-accent rounded px-2 py-1"
              >
                {isLoading ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

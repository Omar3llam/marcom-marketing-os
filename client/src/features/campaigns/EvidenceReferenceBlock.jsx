// ============================================================
// MARCOM / Lumi — EvidenceReferenceBlock
// ------------------------------------------------------------
// What the STORED decision was looking at. Supporting context under a verdict,
// not a second dashboard: no chart, no score, no number this component derives.
// Every line is a field the backend froze onto the decision at the moment it was
// made, rendered as-is.
//
// RENDERS NOTHING WHEN THERE IS NOTHING (the rule this component exists for).
// A null reference means "provenance was not captured" — every decision made
// before R5, and any writer that could not name its evidence honestly. That is
// NOT the same claim as "there was no evidence", so this shows no empty state,
// no "—", and no "No evidence" label. An absence of provenance is rendered as an
// absence, because the alternative is a sentence about the data that the data
// never said.
//
// The distinction runs one level deeper too: `sources: null` is a source the
// reader never projected, `sources: []` would be a read with no contributing
// rows. Only the first is possible on today's writers, and neither is rendered
// as a fabricated source name.
// ============================================================
import { Layers } from 'lucide-react';

// The population's own vocabulary → the marketer-facing noun. Keys are the
// backend's EVIDENCE_POPULATION values; an unrecognised one falls through to
// itself rather than to a guess.
const POPULATION_LABEL = Object.freeze({
  'canonical-verdict': 'Canonical verdict evidence',
  'canonical-fatigue': 'Canonical fatigue evidence',
  'operational':       'Operational evidence',
  'actual-revenue':    'Actual revenue evidence',
  'manual-revenue':    'Uploaded revenue evidence',
});

// The reduction names, spelled out. Deliberately literal: the backend's
// `latest-per-stream-per-day` is an OBSERVATION-day rule over trailing-window
// rows, and a friendlier "daily" here would claim the daily activity the
// ingestion cannot produce.
const REDUCTION_LABEL = Object.freeze({
  'latest-per-entity':         'Latest observation per campaign',
  'latest-per-stream':         'Latest observation per source',
  'latest-per-stream-per-day': 'Latest observation per source, per observation day',
  'effective-by-entity':       'Latest platform row, with actual revenue overlaid',
  'series':                    'Evaluated across the whole series',
  'sum':                       'Summed across rows',
});

const DAY = Object.freeze({ month: 'short', day: 'numeric' });

/** PURE: an ISO instant → "Aug 14", or null when it is not a real instant. */
function observedLabel(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const times = list.map((d) => new Date(d)).filter((d) => Number.isFinite(d.getTime()));
  if (times.length === 0) return null;
  const newest = new Date(Math.max(...times.map((d) => d.getTime())));
  const label = newest.toLocaleDateString(undefined, DAY);
  // More than one observation behind the call is a fact worth stating — it is
  // the difference between one reading and a window of them.
  return times.length > 1 ? `${label} (latest of ${times.length})` : label;
}

export function EvidenceReferenceBlock({ reference = null, className = '' }) {
  // The whole contract, in one line: no reference, no block.
  if (!reference) return null;

  const population = POPULATION_LABEL[reference.population] ?? reference.population ?? null;
  const reduction  = REDUCTION_LABEL[reference.reduction] ?? reference.reduction ?? null;
  const observed   = observedLabel(reference.observedAt);
  const sources    = Array.isArray(reference.sources) && reference.sources.length > 0
    ? reference.sources.join(' · ')
    : null; // null = the reader never captured it. Never rendered as "unknown".
  const rows = Number.isInteger(reference.rowCount) ? reference.rowCount : null;

  // A reference with nothing sayable on it is still not an empty state.
  if (!population && !reduction && !observed && !sources && rows == null) return null;

  return (
    <div className={className}>
      <div className="section-label mb-2 flex items-center gap-1.5 text-lumi-muted">
        <Layers className="w-3 h-3 text-lumi-accent" strokeWidth={1.5} />
        Evidence
      </div>
      <dl className="space-y-1 text-sm text-lumi-text">
        {population && (
          <div className="flex gap-2">
            <dt className="sr-only">Population</dt>
            <dd>
              {population}
              {/* The window rides WITH the population, because it is the thing
                  that makes the population mean something. Omitted entirely when
                  the read could not establish one. */}
              {reference.measurementWindow && (
                <span className="text-lumi-subtle"> · {reference.measurementWindow}</span>
              )}
            </dd>
          </div>
        )}
        {sources && (
          <div className="flex gap-2">
            <dt className="sr-only">Source</dt>
            <dd className="font-mono text-xs text-lumi-muted">{sources}</dd>
          </div>
        )}
        {observed && (
          <div className="flex gap-2">
            <dt className="sr-only">Observed</dt>
            <dd className="text-lumi-subtle">Observed {observed}</dd>
          </div>
        )}
        {rows != null && (
          <div className="flex gap-2">
            <dt className="sr-only">Rows</dt>
            <dd className="text-lumi-subtle">
              {rows} evidence {rows === 1 ? 'row' : 'rows'}
            </dd>
          </div>
        )}
        {reduction && (
          <div className="flex gap-2">
            <dt className="sr-only">Reduction</dt>
            <dd className="text-lumi-subtle">{reduction}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

// ============================================================
// MARCOM / Lumi — CreativeIntelligenceBlock
// ------------------------------------------------------------
// Which creative is carrying or dragging this ad set, according to the server.
//
// PURE RENDERER, same contract as HypothesisBlock / CohortBlock / MemoryTimeline:
// it takes a view model and knows nothing about enums, thresholds, rankings or
// how to fetch anything. Every judgement on screen was made by analyzeEvidence()
// and mapped by creativeIntelligenceViewModel; this file chooses type sizes.
//
// It states a finding and stops. There is no "kill this ad" here, because there
// is no ad-level verdict to say it — the engine ranks ads, it does not judge
// them, and turning "furthest behind on CTR" into an instruction would be this
// component inventing a decision the product never made.
//
// Every figure is null-when-unreported. A missing metric renders "—", never 0,
// and a missing creative age renders "Unknown", never "new".
// ============================================================
import { Sparkles } from 'lucide-react';
import { RelativeBaselineEvidence } from './RelativeBaselineEvidence.jsx';

const Dash = () => <span className="text-lumi-subtle" title="No data" aria-label="No data">—</span>;

const Label = ({ children }) => (
  <p className="font-mono text-[10px] uppercase tracking-widest text-lumi-muted">{children}</p>
);

/** One figure with its name. `value` is already formatted, or null. */
const Figure = ({ label, value }) => (
  <div>
    <Label>{label}</Label>
    <p className="font-mono text-xs tabular-nums text-lumi-muted">{value ?? <Dash />}</p>
  </div>
);

// Display names for the stored video keys. A key the ingestion adds later
// renders under its own name rather than disappearing.
const VIDEO_LABELS = {
  videoView: 'Video views',
  video25:   '25% watched',
  video50:   '50% watched',
  video95:   '95% watched',
};

// Thousands separators, hand-rolled rather than toLocaleString: the latter reads
// the machine's locale, so the same count renders "4,000" on screen and "4.000"
// on a CI box configured differently — and the test asserting one of them lies
// about the other.
const grouped = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * @param {object} props
 * @param {object|null} props.viewModel — buildCreativeIntelligenceViewModel's
 *   output. null renders nothing at all: an ad set whose ads the engine declined
 *   to rank has no creative finding, and an empty card claims otherwise.
 */
export function CreativeIntelligenceBlock({ viewModel = null }) {
  if (!viewModel?.ad) return null;
  const { ad, metrics, videoSignals, ranking, comparison } = viewModel;
  const video = videoSignals ? Object.entries(videoSignals) : [];

  return (
    <div className="mt-2 rounded-lg border border-lumi-border bg-lumi-surface p-4">
      <p className="mb-3 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-lumi-accent">
        <Sparkles className="h-3 w-3" strokeWidth={2} /> Creative intelligence
      </p>

      {/* Which ad, and how old the creative is. Age leads because it is the
          question the rest of the block is usually being read to answer. */}
      <div className="mb-3">
        <p className="font-display text-sm font-semibold text-lumi-text">{ad.name ?? 'Unnamed ad'}</p>
        <p className="mt-0.5 font-mono text-[11px] text-lumi-subtle">
          AD{ad.channel ? ` · ${ad.channel}` : ''}
          {ad.status ? ` · ${ad.status}` : ''}
        </p>
        <p className="mt-1 font-mono text-[11px] text-lumi-muted">
          {/* "Unknown" is the honest reading of a platform that never reported a
              creation time. A blank line would read as "no age worth noting". */}
          Creative age · {ad.creativeAge ?? <span className="text-lumi-subtle">Unknown</span>}
        </p>
      </div>

      {/* The server's finding, verbatim from the view model. */}
      {ranking?.label && (
        <p className="mb-3 text-xs leading-relaxed text-lumi-text">{ranking.label}</p>
      )}

      {comparison && (
        <>
          <Label>Selected comparison</Label>
          <RelativeBaselineEvidence readout={comparison} />
        </>
      )}
      <section aria-label="Context" className="mb-3 border-t border-lumi-border pt-3">
        <Label>Context</Label>
        <div className="mt-1 grid grid-cols-2 gap-3">
          {ranking?.metric !== 'ctr' && <Figure label="CTR" value={metrics.ctr != null ? `${(metrics.ctr * 100).toFixed(2)}%` : null} />}
          {ranking?.metric !== 'roas' && <Figure label="ROAS" value={metrics.roas != null ? `${metrics.roas.toFixed(2)}x` : null} />}
          {ranking?.metric !== 'frequency' && <Figure label="Frequency" value={metrics.frequency != null ? metrics.frequency.toFixed(2) : null} />}
        </div>
      </section>

      {/* Only the signals that were actually reported. An image ad has no video
          section at all — rendering four zeros would say nobody watched it. */}
      {video.length > 0 && (
        <div className="border-t border-lumi-border pt-3">
          <Label>Video signals</Label>
          <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
            {video.map(([key, value]) => (
              <div key={key} className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[11px] text-lumi-muted">{VIDEO_LABELS[key] ?? key}</span>
                <span className="font-mono text-[11px] tabular-nums text-lumi-text">
                  {grouped(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

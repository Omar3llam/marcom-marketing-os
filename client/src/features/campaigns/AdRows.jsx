// ============================================================
// MARCOM / Lumi — AdRows  (Campaigns · under an expanded ad set)
// ------------------------------------------------------------
// The third level of the connector graph: the ads of one ad set, in the order
// the SERVER returned them (creative age, oldest first — the order the fatigue
// question is asked in), followed by the Creative Intelligence finding.
//
// Lives in its own file rather than inside ConnectorCampaignsPanel for the same
// reason AdSetRows nearly should: the panel is already the longest file in the
// feature, and an ad level folded into it would be read as part of the campaign
// row rather than as its own entity dimension.
//
// Governing law, unchanged one level down: every metric traces to a
// MetricSnapshot row, a missing one renders "—" and never 0, and loading /
// error / empty are three distinguishable states — as is a REFUSAL, which is
// none of them.
// ============================================================
import { Loader2, AlertTriangle } from 'lucide-react';
import { EvidenceState } from './EvidenceState.jsx';
import { CreativeIntelligenceBlock } from './CreativeIntelligenceBlock.jsx';
import { buildCreativeIntelligenceViewModel } from './creativeIntelligenceViewModel.js';

/** One full-width message row inside the campaigns table. */
const MessageRow = ({ cols, tone = 'text-lumi-subtle', children }) => (
  <tr><td colSpan={cols} className={`px-4 py-3 text-center text-xs ${tone}`}>{children}</td></tr>
);

/**
 * @param {object} props
 * @param {number} props.cols — the table's column count (the panel owns it)
 * @param {object|null} props.state — useAdsDrillDown's entry for this ad set:
 *   { entity, objective, children }. undefined means the fetch has not resolved.
 * @param {boolean} props.loading
 * @param {?string} props.error
 * @param {object|null} props.evidence — useEvidence's entry for this ad set at
 *   the AD dimension: { evidence, insufficientData, reasonKey }
 * @param {boolean} props.evidenceLoading
 * @param {?string} props.evidenceError
 */
export function AdRows({
  cols, state = null, loading = false, error = null, failure = null,
  evidence = null, evidenceLoading = false, evidenceError = null, evidenceFailure = null,
}) {
  if (loading || (!error && !state)) {
    return (
      <MessageRow cols={cols}>
        <Loader2 className="inline w-3.5 h-3.5 animate-spin mr-1.5" strokeWidth={2} /> Loading ads…
      </MessageRow>
    );
  }

  if (error) {
    const copy = failure?.kind === 'NOT_PERMITTED' ? 'Ads aren’t available for this seat.'
      : failure?.kind === 'CONTRACT_INVALID' ? 'Couldn’t read the ads response.'
        : 'Couldn’t load ads — collapse and try again.';
    return (
      <MessageRow cols={cols} tone={failure?.retryable === false ? 'text-lumi-subtle' : 'text-trend-danger'}>
        <AlertTriangle className="inline w-3.5 h-3.5 mr-1.5" strokeWidth={2} /> {copy}
      </MessageRow>
    );
  }

  const ads = Array.isArray(state.children) ? state.children : [];
  if (ads.length === 0) {
    return <MessageRow cols={cols}>No ads synced for this ad set yet.</MessageRow>;
  }

  // The ranking is the server's; this only maps it for display. null whenever
  // the engine declined — EvidenceState below says which of the three refusals
  // it was, and a refusal is not an error.
  const creative = buildCreativeIntelligenceViewModel({ evidence: evidence?.evidence ?? null });

  return (
    <>
      {ads.map((a) => (
        <tr key={a.entityId} className="bg-lumi-bg/60 border-b border-lumi-border/30">
          <td className="px-4 py-2" />{/* verdicts are campaign-level */}
          <td className="px-4 py-2 pl-16">
            <div className="font-display text-sm text-lumi-text">{a.name}</div>
            <div className="font-mono text-[11px] text-lumi-subtle">
              AD · {a.channel}
              {a.status ? ` · ${a.status}` : ''}
            </div>
          </td>
          {/* CTR carries the ad-level comparison, so it is the column here rather
              than the per-row decisive metric the campaign level picks. */}
          <td className="px-4 py-2 text-right font-mono text-sm tabular-nums text-lumi-text">
            {a.ctr == null
              ? <span className="text-lumi-subtle" title="No data" aria-label="No data">—</span>
              : `${(a.ctr * 100).toFixed(2)}%`}
          </td>
          <td className="px-4 py-2 text-right font-mono text-sm tabular-nums text-lumi-text">
            {a.frequency == null
              ? <span className="text-lumi-subtle" title="No data" aria-label="No data">—</span>
              : a.frequency.toFixed(2)}
          </td>
          <td className="px-4 py-2" />{/* the toggles are campaign-level */}
        </tr>
      ))}

      {/* The finding, committed as its own row for the reason the detail panel is:
          a bare <div> inside a <tbody> gets reparented out of the table. Rendered
          only when there is something to say — a refusal sentence, a failure, a
          spinner, or a real ranking. */}
      {(evidenceLoading || evidenceError || evidence) && (
        <tr className="bg-lumi-bg/60 border-b border-lumi-border/30">
          <td colSpan={cols} className="px-4 pb-3 pt-0 pl-16">
            <EvidenceState
              loading={evidenceLoading}
              error={evidenceError}
              failure={evidenceFailure}
              reasonKey={evidence?.insufficientData ? evidence.reasonKey : null}
              dimension="ad"
              className="py-2"
            />
            <CreativeIntelligenceBlock viewModel={creative} />
          </td>
        </tr>
      )}
    </>
  );
}

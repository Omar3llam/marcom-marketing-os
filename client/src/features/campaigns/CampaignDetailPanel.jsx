// ============================================================
// MARCOM / Lumi — CampaignDetailPanel  (Campaigns · expanded row)
// ------------------------------------------------------------
// The expanded drill-down for one connector campaign: a deterministic SIGNALS
// breakdown (left) + "Lumi's Read", the PRE-GENERATED verdict reasoning (right).
//
// Governing law: every signal traces to a MetricSnapshot row; a missing signal
// renders "—" (Dash), never a fabricated 0. Reasoning is written by the agentic
// sweep (top campaigns by impact), so it shows INSTANTLY on expand — no button,
// no LLM round-trip. Not yet generated → an honest "after the next sweep"; an
// aged row is flagged "may be stale". Cached per campaign for the session.
// ============================================================
import { useEffect } from 'react';
import { Sparkles, Loader2, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '@/lib/money';
import { roasColor, freqColor } from '@/components/campaign-analysis/campaignFormatters.js';
import { HelpTip } from '@/components/ui/HelpTip.jsx';
import { HELP } from '@/lib/helpContent.js';
import { useCampaignReasoning } from '@/hooks/useCampaignReasoning.js';

const Dash = () => <span className="text-lumi-subtle" title="No data" aria-label="No data">—</span>;

/** Compact relative time for the "Updated …" line. */
function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function Signal({ label, help, children }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-lumi-border/40 last:border-0">
      <span className="section-label flex items-center gap-1">{label}{help}</span>
      <span className="font-mono text-sm tabular-nums text-lumi-text">{children}</span>
    </div>
  );
}

export function CampaignDetailPanel({ campaign, verdict = null, impact = null, relativeRank = null }) {
  const { load, reasoning, stale, generatedAt, isLoading, error } = useCampaignReasoning();
  const entityId = campaign.entityId;

  // Load the pre-generated read on expand. load() serves the session cache
  // instantly (no request) when the campaign was already opened this session.
  useEffect(() => {
    load(entityId);
  }, [entityId, load]);

  const ctrPct = campaign.ctr != null ? `${(campaign.ctr * 100).toFixed(2)}%` : null;

  return (
    <div className="grid gap-4 md:grid-cols-2 bg-lumi-bg/40 rounded-xl p-4 my-1">
      {/* ── Signals ─────────────────────────────────────────── */}
      <div>
        <div className="section-label mb-2 text-lumi-muted">Signals</div>
        <Signal label="Verdict" help={<HelpTip content={HELP.VERDICT_COL} />}>{verdict || <Dash />}</Signal>
        <Signal label="Impact" help={<HelpTip variant="popover" content={HELP.IMPACT_SCORE} />}>{impact != null ? `${impact}/10` : <Dash />}</Signal>
        <Signal label="CTR" help={<HelpTip content={HELP.CTR} />}>{ctrPct || <Dash />}</Signal>
        <Signal label="Frequency" help={<HelpTip content={HELP.FREQUENCY} />}>
          {campaign.frequency != null ? <span className={freqColor(campaign.frequency)}>{campaign.frequency.toFixed(2)}</span> : <Dash />}
        </Signal>
        <Signal label="ROAS" help={<HelpTip content={HELP.ROAS} />}>
          {campaign.roas != null ? <span className={roasColor(campaign.roas)}>{campaign.roas.toFixed(2)}x</span> : <Dash />}
        </Signal>
        <Signal label="Spend">
          {campaign.spendMinor != null ? formatCurrency(campaign.spendMinor, campaign.currency || 'USD') : <Dash />}
        </Signal>
        <Signal label="Objective" help={<HelpTip content={HELP.OBJECTIVE} />}>{campaign.objective || <Dash />}</Signal>
        {/* This verdict came from the portfolio-relative post-pass (no revenue to
            score on ROAS) — name the basis so the KILL/SCALE isn't mistaken for one. */}
        {relativeRank && (
          <p className="mt-2 text-xs text-lumi-subtle italic leading-relaxed">
            Ranked relative to this campaign&apos;s cohort — engagement signals only. Add revenue data for ROAS-based scoring.
          </p>
        )}
      </div>

      {/* ── Lumi's Read (pre-generated during the sweep) ─────── */}
      <div className="md:border-l md:border-lumi-border/60 md:pl-4">
        <div className="section-label mb-2 flex items-center gap-1.5 text-lumi-muted">
          <Sparkles className="w-3 h-3 text-lumi-accent" strokeWidth={1.5} />
          Lumi&apos;s Read
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-lumi-subtle py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} /> Loading…
          </div>
        ) : error ? (
          <p className="flex items-center gap-1.5 text-sm text-trend-danger">
            <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2} /> Couldn&apos;t load reasoning.
          </p>
        ) : reasoning ? (
          <div>
            <p className="text-sm text-lumi-text leading-relaxed">{reasoning}</p>
            {generatedAt && (
              <p className="mt-2 text-xs text-lumi-subtle">
                Updated {timeAgo(generatedAt)}
                {stale && <span className="text-signal-hold"> · may be stale</span>}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-lumi-subtle leading-relaxed">
            Reasoning will appear after the next sweep.
          </p>
        )}
      </div>
    </div>
  );
}

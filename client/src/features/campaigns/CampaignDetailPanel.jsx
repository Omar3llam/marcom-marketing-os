// ============================================================
// MARCOM / Lumi — CampaignDetailPanel  (Campaigns · expanded row)
// ------------------------------------------------------------
// The expanded drill-down for one connector campaign: a deterministic SIGNALS
// breakdown (left) + on-demand LLM reasoning, "Lumi's Read" (right).
//
// Governing law: every signal traces to a MetricSnapshot row; a missing signal
// renders "—" (Dash), never a fabricated 0. Reasoning is generated ONLY on click
// (never pre-fetched), cached per campaign for the session, and any cached read
// shows instantly on re-expand. Language follows the onboarding dialect hint.
// ============================================================
import { useEffect } from 'react';
import { Sparkles, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { formatCurrency } from '@/lib/money';
import { roasColor, freqColor } from '@/components/campaign-analysis/campaignFormatters.js';
import { useCampaignReasoning, getCachedReasoning } from '@/hooks/useCampaignReasoning.js';

const Dash = () => <span className="text-lumi-subtle" title="No data" aria-label="No data">—</span>;

function Signal({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-lumi-border/40 last:border-0">
      <span className="section-label">{label}</span>
      <span className="font-mono text-sm tabular-nums text-lumi-text">{children}</span>
    </div>
  );
}

export function CampaignDetailPanel({ campaign, verdict = null, impact = null, dialect = null }) {
  const { getReasoning, regenerate, reasoning, isGenerating, error } = useCampaignReasoning();
  const entityId = campaign.entityId;

  // Show a cached read instantly on expand (no spinner, no API call). Never
  // auto-generate a fresh one — that stays an explicit click.
  useEffect(() => {
    if (getCachedReasoning(entityId)) getReasoning(entityId, { dialect });
  }, [entityId, dialect, getReasoning]);

  const ctrPct = campaign.ctr != null ? `${(campaign.ctr * 100).toFixed(2)}%` : null;

  return (
    <div className="grid gap-4 md:grid-cols-2 bg-lumi-bg/40 rounded-xl p-4 my-1">
      {/* ── Signals ─────────────────────────────────────────── */}
      <div>
        <div className="section-label mb-2 text-lumi-muted">Signals</div>
        <Signal label="Verdict">{verdict || <Dash />}</Signal>
        <Signal label="Impact">{impact != null ? `${impact}/10` : <Dash />}</Signal>
        <Signal label="CTR">{ctrPct || <Dash />}</Signal>
        <Signal label="Frequency">
          {campaign.frequency != null ? <span className={freqColor(campaign.frequency)}>{campaign.frequency.toFixed(2)}</span> : <Dash />}
        </Signal>
        <Signal label="ROAS">
          {campaign.roas != null ? <span className={roasColor(campaign.roas)}>{campaign.roas.toFixed(2)}x</span> : <Dash />}
        </Signal>
        <Signal label="Spend">
          {campaign.spendMinor != null ? formatCurrency(campaign.spendMinor, campaign.currency || 'USD') : <Dash />}
        </Signal>
        <Signal label="Objective">{campaign.objective || <Dash />}</Signal>
      </div>

      {/* ── Lumi's Read (on-demand reasoning) ───────────────── */}
      <div className="md:border-l md:border-lumi-border/60 md:pl-4">
        <div className="section-label mb-2 flex items-center gap-1.5 text-lumi-muted">
          <Sparkles className="w-3 h-3 text-lumi-accent" strokeWidth={1.5} />
          Lumi&apos;s Read
        </div>

        {isGenerating ? (
          <div className="flex items-center gap-2 text-sm text-lumi-subtle py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} /> Analyzing…
          </div>
        ) : error ? (
          <div className="text-sm text-trend-danger">
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2} /> Couldn&apos;t generate reasoning — try again.
            </span>
            <button
              type="button"
              onClick={() => getReasoning(entityId, { dialect })}
              className="mt-2 text-xs font-medium text-lumi-accent hover:underline"
            >
              Retry
            </button>
          </div>
        ) : reasoning ? (
          <div>
            <p className="text-sm text-lumi-text leading-relaxed">{reasoning}</p>
            <button
              type="button"
              onClick={() => regenerate(entityId, { dialect })}
              className="mt-2 inline-flex items-center gap-1 text-xs text-lumi-subtle hover:text-lumi-accent transition-colors"
            >
              <RefreshCw className="w-3 h-3" strokeWidth={2} /> Regenerate
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => getReasoning(entityId, { dialect })}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium',
              'bg-lumi-elevated border border-lumi-border text-lumi-text hover:border-lumi-accent/40 transition-colors',
            )}
          >
            <Sparkles className="w-3.5 h-3.5 text-lumi-accent" strokeWidth={1.5} />
            Get Lumi&apos;s read →
          </button>
        )}
      </div>
    </div>
  );
}

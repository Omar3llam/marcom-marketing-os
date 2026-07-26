// ============================================================
// MARCOM / Lumi — CampaignDetailPanel  (Campaigns · expanded row)
// ------------------------------------------------------------
// The expanded drill-down for one connector campaign: a structured "Why?"
// evidence block for KILL/SCALE (engine rationale + confidence + next step +
// cost of ignoring), then a deterministic SIGNALS breakdown (left) + "Lumi's
// Read", the PRE-GENERATED verdict reasoning (right).
//
// Governing law: every signal traces to a MetricSnapshot row; a missing signal
// renders "—" (Dash), never a fabricated 0. Reasoning is written by the agentic
// sweep (top campaigns by impact), so it shows INSTANTLY on expand — no button,
// no LLM round-trip. Not yet generated → an honest "after the next sweep"; an
// aged row is flagged "may be stale". Cached per campaign for the session.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, AlertTriangle, Copy, Check, AlertCircle, ExternalLink } from 'lucide-react';
import { formatCurrency } from '@/lib/money';
import { roasColor, freqColor } from '@/components/campaign-analysis/campaignFormatters.js';
import { HelpTip } from '@/components/ui/HelpTip.jsx';
import { HELP } from '@/lib/helpContent.js';
import { useCampaignReasoning } from '@/hooks/useCampaignReasoning.js';
import { copyToClipboard } from '@/lib/clipboard.js';
import {
  NO_REVENUE_DISCLAIMER, confidenceLabel, evidenceClause, nextActionFor, ignoreCostFor,
  buildRecommendationText, platformUrl,
} from '@/features/campaigns/verdictEvidence.js';

const Dash = () => <span className="text-lumi-subtle" title="No data" aria-label="No data">—</span>;

// How long the copy button holds its result before returning to rest.
const COPY_FEEDBACK_MS = 2000;

// ── Actions on a decision ────────────────────────────────────
// Lumi initiates, the human acts — neither button touches the ad platform. Copy
// hands the marketer the decision verbatim; the link opens the platform's own UI
// where THEY make the change. Only the two action verdicts get a bar: there is
// nothing to act on for HOLD/WATCH/REFRESH.
function ActionBar({ verdict, name, rationale, confidence, spendMinor, currency, channel, externalId }) {
  const [copyState, setCopyState] = useState('idle'); // idle | copied | failed
  const timerRef = useRef(null);

  // The reset timer must not outlive the panel — collapsing the row mid-countdown
  // would otherwise set state on an unmounted component.
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const nextAction = nextActionFor(verdict);
  if (!nextAction) return null;

  const handleCopy = async () => {
    const { ok } = await copyToClipboard(buildRecommendationText({
      verdict, name, rationale, nextAction, confidence, spendMinor, currency,
    }));
    // An unreported failure is the one outcome worse than no copy button at all:
    // the marketer pastes stale clipboard content believing it is the decision.
    setCopyState(ok ? 'copied' : 'failed');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopyState('idle'), COPY_FEEDBACK_MS);
  };

  // null when the channel has no verified campaign deep-link, or the row carries
  // no platform id — then no link is rendered at all, never a generic one.
  const url = platformUrl(channel, externalId);

  return (
    <div className="mt-3 flex flex-wrap gap-2 border-t border-lumi-border/60 pt-3">
      <button
        type="button"
        onClick={handleCopy}
        aria-label={`Copy the ${verdict} recommendation for ${name}`}
        className="inline-flex items-center gap-1.5 rounded border border-lumi-border px-3 py-1.5 text-[11px] font-medium text-lumi-text transition-colors hover:bg-lumi-elevated"
      >
        {copyState === 'copied' ? <><Check className="w-3 h-3 text-signal-scale" strokeWidth={2} /> Copied</>
          : copyState === 'failed' ? <><AlertCircle className="w-3 h-3 text-signal-kill" strokeWidth={2} /> Couldn&apos;t copy</>
            : <><Copy className="w-3 h-3" strokeWidth={2} /> Copy decision</>}
      </button>

      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded border border-lumi-border px-3 py-1.5 text-[11px] font-medium text-lumi-muted transition-colors hover:bg-lumi-elevated hover:text-lumi-text"
        >
          <ExternalLink className="w-3 h-3" strokeWidth={2} />
          Open in {channel}
        </a>
      )}
    </div>
  );
}

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

export function CampaignDetailPanel({ campaign, verdict = null, impact = null, rationale = null, confidence = null }) {
  const { load, reasoning, stale, generatedAt, isLoading, error } = useCampaignReasoning();
  const entityId = campaign.entityId;

  // Load the pre-generated read on expand. load() serves the session cache
  // instantly (no request) when the campaign was already opened this session.
  useEffect(() => {
    load(entityId);
  }, [entityId, load]);

  const ctrPct = campaign.ctr != null ? `${(campaign.ctr * 100).toFixed(2)}%` : null;

  // The structured "Why?" breakdown for the two action verdicts. Everything here
  // is surfaced, not computed: the evidence line is the engine's own rationale
  // clause, confidence is the engine's score, the cost line quotes real spend/
  // ROAS. A missing piece renders nothing — never an invented reason.
  const isActionVerdict = verdict === 'KILL' || verdict === 'SCALE';
  const evidence = evidenceClause(rationale);
  const confLabel = confidenceLabel(confidence);
  const nextAction = nextActionFor(verdict);
  const ignoreCost = ignoreCostFor({
    verdict, roas: campaign.roas, spendMinor: campaign.spendMinor, currency: campaign.currency || 'USD',
  });

  return (
    <div className="grid gap-4 md:grid-cols-2 bg-lumi-bg/40 rounded-xl p-4 my-1">
      {/* ── Why KILL / SCALE? ───────────────────────────────── */}
      {isActionVerdict && (
        <div className="md:col-span-2 rounded-xl border border-lumi-border/60 bg-lumi-surface/60 p-3">
          <div className="section-label mb-1.5 text-lumi-muted">Why {verdict.toLowerCase()}?</div>
          {evidence && (
            <p className="text-sm text-lumi-text leading-relaxed">
              {evidence}
              {confLabel && <span className="font-mono text-[11px] text-lumi-subtle"> · {confLabel} confidence</span>}
            </p>
          )}
          {nextAction && (
            <p className="mt-1.5 text-sm text-lumi-text">
              <span className="font-semibold">Next step:</span> {nextAction}
            </p>
          )}
          {ignoreCost && <p className="mt-1.5 text-xs text-lumi-muted leading-relaxed">{ignoreCost}</p>}
          {campaign.roas == null && (
            <p className="mt-1.5 text-xs text-lumi-subtle leading-relaxed">{NO_REVENUE_DISCLAIMER}</p>
          )}
          <ActionBar
            verdict={verdict}
            name={campaign.name}
            rationale={rationale}
            confidence={confidence}
            spendMinor={campaign.spendMinor}
            currency={campaign.currency || 'USD'}
            channel={campaign.channel}
            externalId={campaign.externalId}
          />
        </div>
      )}
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

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
import { Fragment, useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, AlertTriangle, Copy, Check, AlertCircle, ExternalLink } from 'lucide-react';
import { formatCurrency } from '@/lib/money';
import { roasColor, freqColor } from '@/components/campaign-analysis/campaignFormatters.js';
import { HelpTip } from '@/components/ui/HelpTip.jsx';
import { HELP } from '@/lib/helpContent.js';
import { useCampaignReasoning } from '@/hooks/useCampaignReasoning.js';
import { copyToClipboard } from '@/lib/clipboard.js';
import { recordIntent } from './decisionSignals.js';
import { useDecisionLearning } from '@/hooks/useDecisionLearning.js';
import { LearningInsight } from './LearningInsight.jsx';
import {
  NO_REVENUE_DISCLAIMER, confidenceLabel, evidenceClause, nextActionFor, ignoreCostFor,
  buildRecommendationText, platformUrl,
  evidenceRows, whyBlock, confidenceDetail, isDataQualityCause,
} from '@/features/campaigns/verdictEvidence.js';
import { buildCounterfactualViewModel } from '@/features/campaigns/counterfactualViewModel.js';
import { CounterfactualsBlock } from '@/features/campaigns/CounterfactualsBlock.jsx';

const Dash = () => <span className="text-lumi-subtle" title="No data" aria-label="No data">—</span>;

// How long the copy button holds its result before returning to rest.
const COPY_FEEDBACK_MS = 2000;

// ── Actions on a decision ────────────────────────────────────
// Lumi initiates, the human acts — neither button touches the ad platform. Copy
// hands the marketer the decision verbatim; the link opens the platform's own UI
// where THEY make the change. Only the two action verdicts get a bar: there is
// nothing to act on for HOLD/WATCH/REFRESH.
function ActionBar({ entityId, verdict, name, rationale, confidence, spendMinor, currency, channel, externalId }) {
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
    // Intent is recorded only on a SUCCESSFUL copy. A failed copy means the
    // recommendation never left the app, so treating it as "the operator acted
    // on this" would put a decision nobody could act on into the learning set.
    if (ok) recordIntent(entityId);
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
          // Fire-and-forget: the navigation is not awaited on it, and the new
          // tab opens whether or not this lands.
          onClick={() => recordIntent(entityId)}
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

/**
 * The engine's evidence[] as a comparison table: its value beside the benchmark
 * it was judged against. Rendered, not restated — the panel adds no arithmetic
 * of its own, so a reader can check the call rather than take it on trust.
 */
function EvidenceTable({ rows }) {
  if (!rows.length) return null;
  return (
    <dl className="mt-2 grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 text-sm">
      {rows.map((r) => (
        <Fragment key={r.metric}>
          <dt className="text-lumi-muted truncate">{r.label}</dt>
          <dd className={`font-mono text-right ${r.status === 'weak' ? 'text-lumi-danger' : 'text-lumi-text'}`}>{r.value}</dd>
          <dd className="font-mono text-right text-lumi-subtle">
            {r.benchmark ? `vs ${r.benchmark}` : <Dash />}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

export function CampaignDetailPanel({
  campaign, verdict = null, impact = null, rationale = null, confidence = null,
  funnel = null, rootCause = null, dataConfidence = null, counterfactuals = null,
}) {
  const { load, reasoning, stale, generatedAt, isLoading, error } = useCampaignReasoning();
  const entityId = campaign.entityId;
  const learning = useDecisionLearning(entityId);

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
  // Which reasons get a block, and under what heading. This used to be an
  // inline `verdict === 'KILL' || verdict === 'SCALE'` — but every funnel
  // diagnosis is a WATCH, so the whole funnel layer rendered nothing.
  const { show: showWhy, heading } = whyBlock({ verdict, funnel, rootCause });
  // Structured first, prose only as the fallback for verdicts that have no
  // funnel (a KILL/SCALE still carries nothing but a sentence).
  const rows = evidenceRows(funnel);

  // The alternatives the engine set aside, for the verdicts that have no funnel
  // — which is exactly the KILL/SCALE pair that costs money. `funnel` only
  // exists when a funnel STAGE was diagnosed and every funnel diagnosis is a
  // WATCH, so the two paths are disjoint by construction: funnel.counterfactual
  // renders below for a WATCH, this block renders for a KILL/SCALE, and they
  // can never appear together or compete for the same slot.
  const counterfactualVM = buildCounterfactualViewModel(counterfactuals);
  const showCounterfactuals = !funnel && counterfactualVM.length > 0;

  // UNCHANGED, deliberately. The obvious move is to suppress the prose clause
  // once the structured block renders — but they answer different questions.
  // evidenceClause names what we think IS wrong; a counterfactual names what we
  // checked and found was fine. Drop the first and a KILL sits under a "Why?"
  // heading listing only rejections, with nothing anywhere saying what was ruled
  // IN. The block below even refers to "the primary explanation" — this line is
  // the only thing on screen that says what that explanation is.
  const evidence = funnel ? null : evidenceClause(rationale);
  const dataOnly = isDataQualityCause(rootCause);
  const conf = confidenceDetail({ confidence, dataConfidence });
  const confLabel = confidenceLabel(confidence);
  // A data-quality state has no action to take on the platform — the honest
  // next step is to wait, which nextActionFor (keyed on verdict) cannot know.
  const nextAction = funnel?.action ?? (dataOnly ? null : nextActionFor(verdict));
  const ignoreCost = ignoreCostFor({
    verdict, roas: campaign.roas, spendMinor: campaign.spendMinor, currency: campaign.currency || 'USD',
  });

  return (
    <div className="grid gap-4 md:grid-cols-2 bg-lumi-bg/40 rounded-xl p-4 my-1">
      {/* ── Why KILL / SCALE? ───────────────────────────────── */}
      {showWhy && (
        <div className="md:col-span-2 rounded-xl border border-lumi-border/60 bg-lumi-surface/60 p-3">
          <div className="section-label mb-1.5 text-lumi-muted">{heading}</div>

          {/* The engine's own diagnosis + the stage it located, when it found
              one. Structured — no sentence is being parsed to get here. */}
          {funnel && (
            <>
              <p className="text-sm text-lumi-text leading-relaxed">
                {funnel.diagnosis}
                {funnel.stage && (
                  <span className="ml-1.5 font-mono text-[11px] text-lumi-subtle">{funnel.stage}</span>
                )}
              </p>
              <EvidenceTable rows={rows} />
              {/* What this is NOT. The single most valuable line here: it is
                  what stops a marketer changing the creative when the creative
                  was the part that worked. */}
              {funnel.counterfactual && (
                <p className="mt-2 text-sm text-lumi-muted leading-relaxed">{funnel.counterfactual}</p>
              )}
            </>
          )}

          {/* Prose fallback: verdicts with no funnel still carry only a
              rationale, so the leading-clause parser stays for them. */}
          {evidence && (
            <p className="text-sm text-lumi-text leading-relaxed">
              {evidence}
              {confLabel && <span className="font-mono text-[11px] text-lumi-subtle"> · {confLabel} confidence</span>}
            </p>
          )}

          {/* verdict → why → what we ruled out → action. Placed after the
              reason and before the ask, because a rejection only means anything
              once you know what it was rejected in favour of.
              TODO (PR#333): hypotheses[] renders BETWEEN the reason and this,
              so the sequence reads "why this" → "why not that" → act. */}
          {showCounterfactuals && <CounterfactualsBlock viewModel={counterfactualVM} />}

          {nextAction && (
            <p className="mt-1.5 text-sm text-lumi-text">
              <span className="font-semibold">Next step:</span> {nextAction}
            </p>
          )}

          {/* Why the confidence is not higher, when thin inputs are the reason.
              "Low" on its own reads as "the engine is unsure about your
              campaign"; the truth is it is unsure about its own evidence. */}
          {funnel && conf && (
            <p className="mt-1.5 font-mono text-[11px] text-lumi-subtle">
              {conf.label} confidence{conf.limitedByData ? ' · limited by available data' : ''}
            </p>
          )}

          {ignoreCost && !dataOnly && <p className="mt-1.5 text-xs text-lumi-muted leading-relaxed">{ignoreCost}</p>}
          {campaign.roas == null && !dataOnly && (
            <p className="mt-1.5 text-xs text-lumi-subtle leading-relaxed">{NO_REVENUE_DISCLAIMER}</p>
          )}
          {/* The action bar builds a "Recommendation" to share and records an
              intent. Neither is meaningful for a state that says we have not
              judged the campaign yet, so a data-quality block omits it rather
              than offering a recommendation there is no evidence for. */}
          {!dataOnly && (
            <ActionBar
              entityId={entityId}
              verdict={verdict}
              name={campaign.name}
              rationale={rationale}
              confidence={confidence}
              spendMinor={campaign.spendMinor}
              currency={campaign.currency || 'USD'}
              channel={campaign.channel}
              externalId={campaign.externalId}
            />
          )}
          {/* How decisions like this one have gone in this workspace. Silent
              below a defensible sample. */}
          {!dataOnly && <LearningInsight learning={learning} />}
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

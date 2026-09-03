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
import { Sparkles, Loader2, AlertTriangle, Copy, Check, AlertCircle, ExternalLink, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { formatCurrency } from '@/lib/money';
import { roasColor, freqColor } from '@/components/campaign-analysis/campaignFormatters.js';
import { HelpTip } from '@/components/ui/HelpTip.jsx';
import { HELP } from '@/lib/helpContent.js';
import { useCampaignReasoning } from '@/hooks/useCampaignReasoning.js';
import { copyToClipboard } from '@/lib/clipboard.js';
import { recordIntent } from './decisionSignals.js';
import { useDecisionLearning } from '@/hooks/useDecisionLearning.js';
import { LearningInsight } from './LearningInsight.jsx';
import { EvidenceReferenceBlock } from './EvidenceReferenceBlock.jsx';
import {
  NO_REVENUE_DISCLAIMER, confidenceLabel, evidenceClause, nextActionFor, ignoreCostFor,
  buildRecommendationText, platformUrl,
  evidenceRows, whyBlock, confidenceDetail, isDataQualityCause,
} from '@/features/campaigns/verdictEvidence.js';
import { buildCounterfactualViewModel } from '@/features/campaigns/counterfactualViewModel.js';
import { CounterfactualsBlock } from '@/features/campaigns/CounterfactualsBlock.jsx';
import { buildPrimaryHypothesisViewModel } from '@/features/campaigns/hypothesisViewModel.js';
import { HypothesisBlock } from '@/features/campaigns/HypothesisBlock.jsx';
import { CohortBlock } from '@/features/campaigns/CohortBlock.jsx';
import { MemoryTimeline } from '@/features/campaigns/MemoryTimeline.jsx';
import { buildMemoryTimelineViewModel } from '@/features/campaigns/memoryTimelineViewModel.js';
import { DecisionLifecycle } from '@/features/campaigns/DecisionLifecycle.jsx';
import { LumiExecute } from '@/features/campaigns/LumiExecute.jsx';
import { DecisionJudgment } from '@/features/campaigns/DecisionJudgment.jsx';

const Dash = () => <span className="text-lumi-subtle" title="No data" aria-label="No data">—</span>;

// How long the copy button holds its result before returning to rest.
const COPY_FEEDBACK_MS = 2000;

// ── Actions on a decision ────────────────────────────────────
// Lumi initiates, the human acts — neither button touches the ad platform. Copy
// hands the marketer the decision verbatim; the link opens the platform's own UI
// where THEY make the change. Only the two action verdicts get a bar: there is
// nothing to act on for HOLD/WATCH/REFRESH.
//
// It also asks whether they acted, because that answer belongs to the DECISION,
// not to the ad-set evidence underneath it. It used to live only in
// ExecutionContext, which meant recording a KILL took "Explain decision" →
// "View ad sets" → wait for a ranking → answer — and an ad set the engine
// declined to rank removed the question entirely, from a verdict that was
// perfectly answerable. Evidence explains WHERE to look; it was never the
// precondition for saying what you did.
//
// SAME GATE as the utility actions above it (nextActionFor), deliberately
// unbroadened: a verdict with nothing to act on has nothing to have acted on.
function ActionBar({
  entityId, verdict, name, rationale, confidence, spendMinor, currency, channel, externalId,
  onExecute = null, onDismiss = null, executionState = null,
  // R13-D / B3 — the SERVER's executability descriptor and the real-execution
  // lifecycle beside it. Separate props from onExecute/executionState because
  // they are a separate act: one records a claim, the other changes the ad account.
  execution = null, onLumiExecute = null, lumiState = null, lumiRejection = null,
}) {
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
    <>
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

      {/* BELOW the utility actions, and last in the panel. The reader should
          understand the decision — why, cohort, reasoning, memory, next step —
          before being asked whether they acted on it; a claim collected above
          its own evidence is a claim about something the operator has not read
          yet. Renders nothing at all when the host passes no callbacks, which
          is how every other consumer of this panel stays unchanged. */}
      {/* R13-D / B3 — LUMI ACTS. Above the self-report on purpose: when Lumi
          can perform the action, that is the offer, and "I already did this"
          becomes the fallback for an operator who went to Ads Manager instead.
          Renders nothing when the server says this verdict is not executable. */}
      <LumiExecute
        execution={execution}
        onExecute={onLumiExecute}
        state={lumiState}
        rejection={lumiRejection}
        className="mt-3 border-t border-lumi-border/60 pt-3"
      />
      <DecisionLifecycle
        onExecute={onExecute}
        onDismiss={onDismiss}
        executionState={executionState}
        className="mt-3 border-t border-lumi-border/60 pt-3"
      />
    </>
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
  funnel = null, rootCause = null, dataConfidence = null, signalConfidence = null,
  counterfactuals = null, hypotheses = null, relativeRank = null,
  relativeContext = null, memory = null,
  // C-03 — whether `memory` being null means "we have never judged this
  // campaign" or "we could not read its history". They render differently
  // because they are different sentences, and one of them is about us.
  //
  // C-06 — the server's full name, kept. `decisionHistoryKnowledge` is the
  // same fact in the shared language and is what the view model reads.
  decisionHistoryStatus = null,
  decisionHistoryKnowledge = null,
  // What the STORED decision was looking at (R5). null on every decision made
  // before provenance was captured, and on campaigns with no stored decision at
  // all — the block below renders nothing rather than implying an absence of
  // evidence, which is a different claim.
  evidenceReference = null,
  // The decision lifecycle, owned by the PARENT. No hook here on purpose: the
  // campaigns table renders one of these per row from a single useDecisionAction
  // instance, and state has to stay keyed by entityId — a hook inside the panel
  // would give every expanded row its own map and lose the answer on collapse.
  onExecute = null, onDismiss = null, executionState = null,
  // R13-b — the judgement axis, owned by the PARENT for the same reason the
  // lifecycle is: one useDecisionJudgment instance serves every row, and a hook
  // in here would give each expanded row its own map and drop the answer on
  // collapse. `decisionId` null ⇒ DecisionJudgment renders nothing; `judgment`
  // is the SERVER's record (persisted read, or this session's newer answer),
  // never a local draft; `onJudge` null ⇒ read-only.
  decisionId = null, judgment = null, judgmentState = null,
  judgmentMessage = null, onJudge = null,
  // R13-D / B3 — REAL execution, owned by the PARENT for the same reason as the
  // two axes above: one useLumiExecution instance serves every row, keyed by
  // decisionId.  is the SERVER's descriptor off the verdict payload —
  // never derived here, because deciding what Meta can be asked to do is the
  // mutation layer's judgement, not a component's.
  execution = null, onLumiExecute = null, lumiState = null, lumiRejection = null,
}) {
  // OPEN on mount. The disclosure exists to let a reader put the audit trail
  // away, not to hide it: a verdict whose reasoning takes a click reads as
  // opaque, and the mechanism and the rejections are the case FOR the call.
  // Reset per campaign by the panel's own remount — the expanded row unmounts on
  // collapse, so a reader who closed this on one campaign meets an open one on
  // the next.
  // Revisit when memory and outcomes land in this panel (density review).
  const [reasoningOpen, setReasoningOpen] = useState(true);
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

  // The mechanism the verdict rests on — hypotheses[0] only, since [1..n] are
  // already on screen above as the alternatives. Null when the cohort pass
  // decided the call and the absolute reasoning did not (see hypothesisViewModel).
  const hypothesisVM = funnel ? null : buildPrimaryHypothesisViewModel(hypotheses, relativeRank);

  // What decided a cohort verdict, when one did. Mutually exclusive with the
  // hypothesis block by construction — relativeContext exists only where
  // relativeRank does, which is exactly where the honesty gate returns null — so
  // the two never argue over the same verdict.
  //
  // NOT gated on `funnel`, unlike the two blocks above. They step aside for a
  // funnel because the funnel diagnosis IS the explanation there; a relative
  // upgrade is decided by cohort rank whatever the funnel found, so on those
  // rows this is the only thing on screen that names the actual basis.
  //
  // Guards what is RENDERED, which is now the cohort size alone — a card reading
  // "Ranked against  campaigns" is worse than no card. It deliberately no longer
  // requires ctrPct/avgCtrPct: those ride along for other surfaces, and since
  // this block stopped printing them, demanding them would suppress a perfectly
  // renderable card over two fields nobody reads.
  const cohortVM = relativeContext && Number.isFinite(relativeContext.cohortSize)
    ? relativeContext
    : null;

  // What goes BEHIND the disclosure. The cohort block is deliberately not in
  // here: it stays visible, so this is the mechanism and the rejections only —
  // a single argument ("here is what we think, here is what we ruled out"),
  // which is why they share one control rather than collapsing separately.
  //
  // cohortVM was a term here while the block lived inside the section. Leaving
  // it would give a cohort-decided verdict — hypothesis suppressed by the
  // honesty gate, counterfactuals suppressed with it — a "Reasoning" toggle
  // that opens onto nothing.
  const showReasoning = Boolean(hypothesisVM) || showCounterfactuals;

  // What we said about this campaign BEFORE. Deliberately NOT part of
  // showReasoning and not inside the disclosure below: those blocks are the case
  // for TODAY'S verdict, and a past KILL is not evidence for the current one.
  // Filing history under "Reasoning" would invite exactly that reading, and it
  // would also let the toggle hide it.
  const memoryVM = buildMemoryTimelineViewModel(memory, decisionHistoryStatus, decisionHistoryKnowledge);

  // UNCHANGED, deliberately. The obvious move is to suppress the prose clause
  // once the structured block renders — but they answer different questions.
  // evidenceClause names what we think IS wrong; a counterfactual names what we
  // checked and found was fine. Drop the first and a KILL sits under a "Why?"
  // heading listing only rejections, with nothing anywhere saying what was ruled
  // IN. The block below even refers to "the primary explanation" — this line is
  // the only thing on screen that says what that explanation is.
  const evidence = funnel ? null : evidenceClause(rationale);
  const dataOnly = isDataQualityCause(rootCause);
  const conf = confidenceDetail({ confidence, dataConfidence, signalConfidence });
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

          {/* ALWAYS VISIBLE, and outside the disclosure below. On a cohort
              verdict this is not supporting detail — it is the entire basis for
              the call, and the only thing on screen naming it. Putting it behind
              a closed toggle would hide the reason a campaign is being killed
              behind a click. */}
          <CohortBlock viewModel={cohortVM} />

          {/* verdict → why → what we ruled out → action. ONE control for both
              blocks, because they are a single argument: a rejection only means
              something once you know what it was rejected in favour of, and
              collapsing them separately would let a reader open the second
              without the first.

              Closed by default. The verdict, its reason and the ask are all
              above it already; this is the audit trail for a reader who wants to
              challenge the call, and it is long enough to bury the ask when it
              is not. Panel-level state deliberately — the blocks stay pure
              renderers that take a view model and emit JSX, which is what lets
              them move to a feed or a narrative later. */}
          {showReasoning && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setReasoningOpen((o) => !o)}
                aria-expanded={reasoningOpen}
                className="flex w-full items-center gap-1 text-left section-label text-lumi-muted transition-colors hover:text-lumi-text"
              >
                {/* The chevron ROTATES and the label never changes — the same
                    affordance the campaign rows use, so one gesture means one
                    thing across the page. */}
                <ChevronRight
                  className={cn('w-3 h-3 transition-transform duration-200', reasoningOpen && 'rotate-90 text-lumi-accent')}
                  strokeWidth={2}
                />
                Reasoning
              </button>

              {reasoningOpen && (
                <div className="mt-1">
                  <HypothesisBlock viewModel={hypothesisVM} />
                  {showCounterfactuals && <CounterfactualsBlock viewModel={counterfactualVM} />}
                </div>
              )}
            </div>
          )}

          {/* AFTER Reasoning, OUTSIDE its disclosure, and before the ask:
              verdict → why → reasoning → memory → action. History is context for
              the decision a reader is about to make, not part of the argument
              for it, so it gets its own layer and is never hidden by the
              Reasoning toggle. */}
          <MemoryTimeline viewModel={memoryVM} />

          {nextAction && (
            <p className="mt-1.5 text-sm text-lumi-text">
              <span className="font-semibold">Next step:</span> {nextAction}
            </p>
          )}

          {/* Why the confidence is not higher. "Low" on its own reads as "the
              engine is unsure about your campaign"; the truth is it is unsure
              about its own evidence, and this says which half.

              STILL FUNNEL-ONLY, deliberately. On a KILL/SCALE the same question
              is answered inside HypothesisBlock's "Signal quality" line, which
              renders only when there is no funnel — so the two are disjoint by
              the same construction that keeps the counterfactual blocks apart,
              and every row gets exactly one answer rather than two. Widening
              this gate would put a second confidence line on a KILL, sourced
              from `signalConfidence` where the block's comes from the
              hypothesis, and a relative upgrade re-stamps the first without
              touching the second.

              SUPPRESSED ON COHORT ROWS. A relative upgrade stamps
              signalConfidence at exactly RR.CONFIDENCE (0.6), which composes
              against healthy data to a product BELOW the Medium band while
              neither half is itself below it — so the line reads "Low
              confidence" and names no reason, because by its own test there
              isn't one. The cohort block above explains the verdict properly;
              leaving this underneath it prints an unexplained doubt over a
              complete explanation. */}
          {funnel && conf && !relativeRank && (
            <p className="mt-1.5 font-mono text-[11px] text-lumi-subtle">
              {conf.label} confidence
              {conf.limitedByData && ' · limited by available data'}
              {/* "limited supporting signal quality", not "weak signal": the
                  claim is about our evidence, not about the campaign. */}
              {conf.limitedBySignal && ' · limited supporting signal quality'}
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
              onExecute={onExecute}
              onDismiss={onDismiss}
              executionState={executionState}
              execution={execution}
              onLumiExecute={onLumiExecute}
              lumiState={lumiState}
              lumiRejection={lumiRejection}
            />
          )}
          {/* How decisions like this one have gone in this workspace. Silent
              below a defensible sample. */}
          {!dataOnly && <LearningInsight learning={learning} />}

          {/* ── R13-b · what the HUMAN decided ──────────────────────────────
              LAST, and inside the "why" block on purpose: this asks the
              operator to judge a call, and a judgement collected above its own
              reasoning is a judgement of something unread. It sits below
              DecisionLifecycle for the same reason — "did you act" is about the
              ad account, "what did you decide" is about the recommendation, and
              the second is the harder question.

              NOT gated on `dataOnly`. A verdict the engine hedged because the
              data was thin is exactly the one an operator most often overrides,
              and that override is the signal. Gated only on `decisionId`, by the
              component itself. */}
          <DecisionJudgment
            decisionId={decisionId}
            judgment={judgment}
            state={judgmentState}
            message={judgmentMessage}
            onSubmit={onJudge}
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

        {/* What the stored decision was looking at. Under the reasoning on
            purpose: the reasoning is the claim, this is what it rests on.
            Renders nothing at all when no provenance was captured. */}
        <EvidenceReferenceBlock reference={evidenceReference} className="mt-4" />
      </div>
    </div>
  );
}

// ============================================================
// MARCOM — Content Lab Page
// ============================================================
// Two-panel layout: left = input/controls, right = generated output.
// Generates on-brand copy, headlines, CTAs, visual briefs, video scripts.
// ============================================================
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Send, X, ChevronDown, Check, Sparkles, ArrowRight,
} from 'lucide-react';
import { useWorkspace } from '@/hooks/useWorkspace.js';
import { useContentGeneration } from '@/hooks/useContentGeneration.js';
import { useContentHistory } from '@/hooks/useContentHistory.js';
import { useConnectorCampaigns } from '@/hooks/useConnectorCampaigns.js';
import { useConnectorVerdicts } from '@/hooks/useConnectorVerdicts.js';
import { useOnboardingContext } from '@/hooks/useOnboardingContext.js';
import { VerdictBadge } from '@/components/primitives';
import { getContentRecommendations } from '@/lib/contentRecommendations.js';
import { TONES } from '@/pages/OnboardingPage/constants.js';
import { resolveBrandContext } from './brandContext.js';
import { VISUAL_FORMATS, DEFAULT_FORMAT_ID, formatById, formatToPromptFields } from './visualFormats.js';
import { OutputEmpty, OutputGenerating, OutputDone, OutputError } from './OutputComponents.jsx';
import HistoryRail, { relTime } from './HistoryRail.jsx';
import { OptToggle } from './OptToggle.jsx';

export default function ContentLabView() {
  const navigate = useNavigate();
  const { workspace } = useWorkspace();
  const { context: onboarding } = useOnboardingContext();
  // Live connector campaigns (MetricSnapshot-backed entity graph), NOT the
  // legacy CampaignState feed — so "Sync Live Meta" campaigns are selectable.
  const { campaigns, loading: campaignsLoading } = useConnectorCampaigns();
  // Engine verdicts over the same connector graph, keyed by entityId — the
  // DECISION that drives the diagnosis + recommendations below. rationale here is
  // the always-present verdict rationale (not the top-N-only prose "Read").
  const { verdicts } = useConnectorVerdicts();
  const verdictMap = useMemo(
    () => Object.fromEntries((verdicts ?? []).map((v) => [v.id, v])),
    [verdicts],
  );
  const {
    generate: generateContent,
    content,
    loading,
    error: apiError,
    reset: resetGeneration,
  } = useContentGeneration();
  // Saved-generations history (workspace-scoped). Refetched after each generate.
  const { generations, isLoading: historyLoading, error: historyError, refetch: refetchHistory } = useContentHistory();

  // Real brand signals from the onboarding profile (tone, industry, objective,
  // audience). null fields mean "not onboarded yet" — we send nothing rather
  // than a fabricated value, and the backend applies its own last resort.
  const brand = useMemo(() => resolveBrandContext(onboarding), [onboarding]);

  const [opts, setOpts] = useState({
    copy: true,
    headlines: true,
    cta: true,
    visual: true,
    video: false,
  });
  // Tone is the onboarding tone by default; the picker lets the user choose a
  // different register for THIS piece (override) without touching brand voice.
  const [toneOverride, setToneOverride] = useState(null);
  const [contextCampaign, setContextCampaign] = useState(null);
  const [campaignMenuOpen, setCampaignMenuOpen] = useState(false);
  const [toneMenuOpen, setToneMenuOpen] = useState(false);
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  // Visual ad format — drives the brief's format + dimensions (one pick, both
  // values). Default is the most common Meta placement; the user can change it.
  const [formatId, setFormatId] = useState(DEFAULT_FORMAT_ID);
  // Which saved generation (if any) is being VIEWED read-only in the output panel.
  const [viewingId, setViewingId] = useState(null);
  // Operator's product brief (PR #254) — grounds the copy in what's being sold.
  // All optional. Cleared whenever the campaign changes (see the picker + clear
  // handlers) so a stale product never leaks into a different campaign's copy.
  const [product, setProduct] = useState('');
  const [offer, setOffer] = useState('');
  const [keyFacts, setKeyFacts] = useState('');

  const tone = toneOverride ?? brand.toneLabel ?? 'Warm & familial';
  const usingOnboardingTone = toneOverride == null && !!brand.toneLabel;
  const selectedFormat = formatById(formatId);

  const viewing = viewingId ? generations.find((g) => g.id === viewingId) : null;
  // Show the "by <email>" line only when the workspace history has >1 author.
  const multiUser = new Set(generations.map((g) => g.createdBy?.email).filter(Boolean)).size > 1;

  // Derive phase from hook state
  const phase = loading ? 'generating' : apiError ? 'error' : content ? 'done' : 'idle';

  const generate = async () => {
    const p = product.trim(), o = offer.trim(), k = keyFacts.trim();
    const hasProductBrief = p || o || k;
    // Build the context once: campaign signals + (PR #253) the decision that drives
    // the piece (recorded in the saved snapshot, not fed to the prompt) + (PR #254)
    // the operator's product brief. Non-null when there's a campaign OR a product.
    const campaignContext = (contextCampaign || hasProductBrief) ? {
      name: contextCampaign?.campaign ?? undefined,
      adset: contextCampaign?.adset ?? undefined,
      // Ground generation in the campaign's REAL diagnosis + CTR (or omit them) —
      // never a hardcoded "CTR fell 36%" the campaign never produced.
      problem: contextCampaign?.diagnosis || undefined,
      ctr: contextCampaign?.ctr ?? undefined,
      verdict: decision?.verdict ?? undefined,
      rationale: decision?.rationale ?? undefined,
      signalType: decision?.signalType ?? undefined,
      product: p || undefined,
      offer: o || undefined,
      keyFacts: k || undefined,
    } : null;

    await generateContent({
      campaignContext,
      options: opts,
      tone,
      // All four below trace to the workspace's onboarding profile, resolved to
      // readable descriptors above. undefined when absent (no fabrication).
      brandVoice: brand.brandVoice || undefined,
      targetAudience: brand.audience || undefined,
      industry: brand.industry || undefined,
      objective: brand.objective || undefined,
      // Visual brief format + dimensions from the picker (one real selection).
      ...(opts.visual ? formatToPromptFields(formatId) : {}),
    });
    refetchHistory();   // surface the just-saved generation in the rail
    setViewingId(null); // ensure the live result (not a history item) shows
  };

  const reset = () => {
    resetGeneration();
  };

  // Regenerate from a saved item: pre-fill the form with its context, then drop
  // back to the live flow so the user can tweak and re-generate.
  const regenerateFromHistory = (gen) => {
    const ctx = gen?.context ?? {};
    if (ctx.options) setOpts({ copy: false, headlines: false, cta: false, visual: false, video: false, ...ctx.options });
    if (ctx.tone) setToneOverride(ctx.tone);
    if (ctx.campaignContext?.name) {
      setContextCampaign({
        campaign: ctx.campaignContext.name,
        adset: ctx.campaignContext.adset ?? '',
        diagnosis: ctx.campaignContext.problem ?? null,
        ctr: ctx.campaignContext.ctr ?? null,
      });
    }
    // Restore the saved product brief (PR #254). Runs after the campaign restore
    // above; nothing resets it (resets only fire on an explicit picker/clear).
    setProduct(ctx.campaignContext?.product ?? '');
    setOffer(ctx.campaignContext?.offer ?? '');
    setKeyFacts(ctx.campaignContext?.keyFacts ?? '');
    setViewingId(null);
    resetGeneration();
  };

  // Historical view — reconstruct OutputDone's props from the saved context.
  const vCtx = viewing?.context ?? {};
  const vOpts = vCtx.options ?? { copy: true, headlines: true, cta: true, visual: true, video: false };
  const vTone = vCtx.tone || 'your brand voice';
  const vCampaign = vCtx.campaignContext ? { campaign: vCtx.campaignContext.name, adset: vCtx.campaignContext.adset } : null;

  // The engine verdict for the picked campaign (by entityId) — null when nothing
  // is picked, or the campaign isn't scored yet (gated / needs revenue). Its
  // rationale + signalType drive the deterministic recommendations (no AI).
  const decision = contextCampaign?.entityId ? verdictMap[contextCampaign.entityId] ?? null : null;
  const recommendations = getContentRecommendations(decision?.verdict, decision?.signalType);
  const confidenceLabel = decision?.confidence == null ? null
    : decision.confidence >= 0.8 ? 'High'
    : decision.confidence >= 0.6 ? 'Medium'
    : 'Low';

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      {/* Header */}
      <header className="mb-5">
        <div className="font-mono text-[11px] tracking-[0.08em] uppercase text-dark-muted mb-2 flex items-center gap-2">
          <Send className="w-3.5 h-3.5 text-lumi-accent" strokeWidth={1.5} />
          Creative Optimizer · Module 03
        </div>
        <h1 className="font-display font-bold text-[30px] tracking-tight text-dark-base">
          Fix the bleed. Generate on-brand copy + visuals.
        </h1>
        <p className="mt-2 text-[14px] text-dark-soft leading-relaxed max-w-[560px]">
          Improve creative performance using campaign diagnosis.
        </p>
      </header>

      {/* Three-panel layout: input · history rail · output. Stacks on mobile. */}
      <div className="grid grid-cols-1 lg:grid-cols-[360px_236px_1fr] gap-4">
        {/* LEFT: Input & Controls - sticky on desktop only */}
        <aside className="bg-surface-card border border-surface-border rounded-xl p-5 shadow-card self-start lg:sticky lg:top-6">
          <div className="section-label mb-3">Campaign context</div>

          {contextCampaign ? (
            <div className="relative p-3.5 bg-lumi-accent/5 border border-lumi-accent/30 rounded-lg mb-3.5">
              <button
                onClick={() => { setContextCampaign(null); setProduct(''); setOffer(''); setKeyFacts(''); }}
                className="absolute top-2 right-2 p-0.5 text-dark-muted hover:text-dark-base transition-colors"
              >
                <X className="w-3 h-3" strokeWidth={1.5} />
              </button>
              <div className="font-mono text-[10px] tracking-[0.08em] uppercase text-lumi-accent mb-1">
                Pre-loaded from Campaigns
              </div>
              <div className="font-display font-semibold text-[13px] text-dark-base pr-4">
                {contextCampaign.campaign}
              </div>
              <div className="font-mono text-[11px] text-dark-muted mt-0.5">
                {contextCampaign.adset}
              </div>
            </div>
          ) : (
            <div className="relative mb-3.5">
              <button
                type="button"
                onClick={() => setCampaignMenuOpen((open) => !open)}
                aria-haspopup="listbox"
                aria-expanded={campaignMenuOpen}
                className="w-full flex items-center justify-between p-3 bg-surface-elevated border border-surface-border rounded-lg hover:bg-surface-card transition-colors"
              >
                <span className="font-display text-[13px] text-dark-soft">Select a campaign…</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-dark-muted transition-transform ${campaignMenuOpen ? 'rotate-180' : ''}`}
                  strokeWidth={1.5}
                />
              </button>

              {campaignMenuOpen && (
                <>
                  {/* Click-away backdrop — closes the menu without a global listener */}
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setCampaignMenuOpen(false)}
                  />
                  <ul
                    role="listbox"
                    className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-y-auto bg-surface-card border border-surface-border rounded-lg shadow-card py-1"
                  >
                    {campaignsLoading ? (
                      <li>
                        <span className="block px-3 py-2.5 font-display text-[13px] text-dark-soft">
                          Loading campaigns…
                        </span>
                      </li>
                    ) : campaigns.length === 0 ? (
                      <li>
                        <button
                          type="button"
                          onClick={() => { setCampaignMenuOpen(false); navigate('/app/campaigns'); }}
                          className="w-full text-left px-3 py-2.5 hover:bg-surface-elevated transition-colors"
                        >
                          <span className="font-display text-[13px] text-dark-soft">
                            Sync your Meta account first to select a campaign
                          </span>
                        </button>
                      </li>
                    ) : (
                      campaigns.map((c) => (
                        <li key={c.entityId}>
                          <button
                            type="button"
                            onClick={() => {
                              // Connector rows carry live metrics but no per-campaign
                              // diagnosis (the workspace's top verdicts are auto-injected
                              // into the prompt server-side). CTR is a fraction on the
                              // snapshot → convert to the percentage the prompt expects;
                              // null stays null (never a fabricated metric).
                              setContextCampaign({
                                entityId:  c.entityId,  // keys the engine verdict lookup (diagnosis + recs)
                                campaign:  c.name,
                                adset:     c.channel,
                                diagnosis: null,
                                tag:       null,
                                ctr:       c.ctr != null ? +(c.ctr * 100).toFixed(2) : null,
                              });
                              // Fresh campaign → clear the product brief so a stale
                              // product never grounds the new campaign's copy.
                              setProduct(''); setOffer(''); setKeyFacts('');
                              setCampaignMenuOpen(false);
                            }}
                            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-surface-elevated transition-colors"
                          >
                            <span className="font-display text-[13px] text-dark-base truncate">
                              {c.name}
                            </span>
                            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-dark-muted flex-shrink-0">
                              {c.channel}
                            </span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                </>
              )}
            </div>
          )}

          {/* Diagnosis — the engine's verdict + rationale for the picked campaign.
              Decision-first: the real verdict drives the piece, replacing the old
              generic "Problem detected" placeholder. */}
          {contextCampaign && (
            <div className="p-3.5 bg-surface-elevated border border-surface-border rounded-lg mb-3.5">
              <div className="section-label mb-2">Diagnosis</div>
              {decision?.verdict ? (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <VerdictBadge verdict={decision.verdict} className="text-[11px] px-2.5 py-1 rounded-lg gap-1.5" />
                    {confidenceLabel && (
                      <span className="font-mono text-[10px] text-dark-muted">{confidenceLabel} confidence</span>
                    )}
                  </div>
                  {decision.rationale && (
                    <p className="text-[11px] text-dark-soft leading-relaxed">{decision.rationale}</p>
                  )}
                  {decision.relativeRank === 'BOTTOM' && (
                    <p className="mt-1 text-[10px] font-medium text-signal-kill">Lowest performer in your portfolio</p>
                  )}
                  {decision.relativeRank === 'TOP' && (
                    <p className="mt-1 text-[10px] font-medium text-signal-scale">Top performer in your portfolio</p>
                  )}
                </>
              ) : (
                <p className="text-[11px] text-dark-soft leading-relaxed">
                  No verdict yet — this campaign needs revenue data or a fresh sync to be scored. Generation still uses your brand voice and the account&apos;s live performance.
                </p>
              )}
            </div>
          )}

          {/* Lumi recommends — deterministic content actions derived from the
              verdict + signalType (no AI call, no fabrication). */}
          {recommendations.length > 0 && (
            <div className="p-3.5 bg-surface-elevated border border-surface-border rounded-lg mb-4.5">
              <div className="section-label mb-2">Lumi recommends</div>
              <ul className="space-y-1.5">
                {recommendations.map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <Check className="w-3 h-3 mt-0.5 text-lumi-accent flex-shrink-0" strokeWidth={2.5} />
                    <span className="text-[11px] text-dark-soft leading-relaxed">{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Product context (PR #254) — grounds the copy in what's actually being
              sold. All optional; the product name falls back to the campaign name
              server-side. Cleared when the campaign changes (stale product = bad copy). */}
          <div className="p-3.5 bg-surface-elevated border border-surface-border rounded-lg mb-4.5">
            <div className="section-label mb-2.5">Product context</div>

            <label className="block mb-2.5">
              <span className="font-mono text-[10px] text-dark-muted block mb-1">Product / Service</span>
              <input
                type="text"
                value={product}
                onChange={(e) => setProduct(e.target.value)}
                placeholder="e.g. Golf villa in New Cairo"
                className="w-full bg-surface-card border border-surface-border rounded-lg px-3 py-2 font-display text-xs text-dark-base placeholder:text-dark-subtle focus:border-lumi-accent focus:outline-none transition-colors"
              />
            </label>

            <label className="block mb-2.5">
              <span className="font-mono text-[10px] text-dark-muted block mb-1">Offer <span className="text-dark-subtle">· optional</span></span>
              <input
                type="text"
                value={offer}
                onChange={(e) => setOffer(e.target.value)}
                placeholder="e.g. 5% down · 8-year installments"
                className="w-full bg-surface-card border border-surface-border rounded-lg px-3 py-2 font-display text-xs text-dark-base placeholder:text-dark-subtle focus:border-lumi-accent focus:outline-none transition-colors"
              />
            </label>

            <label className="block mb-3">
              <span className="font-mono text-[10px] text-dark-muted block mb-1">Key facts <span className="text-dark-subtle">· optional</span></span>
              <input
                type="text"
                value={keyFacts}
                onChange={(e) => setKeyFacts(e.target.value)}
                placeholder="e.g. Ready to move · Delivery 2027 · Free clubhouse"
                className="w-full bg-surface-card border border-surface-border rounded-lg px-3 py-2 font-display text-xs text-dark-base placeholder:text-dark-subtle focus:border-lumi-accent focus:outline-none transition-colors"
              />
            </label>

            {/* Landing-page auto-fill — honest "coming soon" (URL fetch not wired). */}
            <div className="flex items-center gap-2 pt-2 border-t border-surface-border">
              <span className="font-mono text-[10px] text-dark-muted">Auto-fill from landing page</span>
              <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-surface-card text-dark-subtle tracking-wider">Coming soon</span>
            </div>
          </div>

          {/* Generate options */}
          <div className="section-label mb-2.5">Generate</div>
          <div className="space-y-1.5 mb-4.5">
            <OptToggle
              on={opts.copy}
              onToggle={() => setOpts({ ...opts, copy: !opts.copy })}
              label="Ad copy variants"
              sub="3 angles"
            />
            <OptToggle
              on={opts.headlines}
              onToggle={() => setOpts({ ...opts, headlines: !opts.headlines })}
              label="Headlines"
              sub="3 options"
            />
            <OptToggle
              on={opts.cta}
              onToggle={() => setOpts({ ...opts, cta: !opts.cta })}
              label="CTA options"
              sub="3 variants"
            />
            <OptToggle
              on={opts.visual}
              onToggle={() => setOpts({ ...opts, visual: !opts.visual })}
              label="Visual brief"
              sub="DALL·E ready"
            />
            <OptToggle
              on={opts.video}
              onToggle={() => {}}
              disabled
              label="Video script"
              sub="Coming soon"
            />
          </div>

          {/* Visual format — only relevant when a visual brief is requested. One
              pick sets both the brief's format and its pixel dimensions. */}
          {opts.visual && (
            <>
              <div className="section-label mb-2.5">Visual format</div>
              <div className="relative mb-4.5">
                <button
                  type="button"
                  onClick={() => setFormatMenuOpen((open) => !open)}
                  aria-haspopup="listbox"
                  aria-expanded={formatMenuOpen}
                  className="w-full flex items-center justify-between p-2.5 bg-surface-elevated border border-surface-border rounded-lg hover:bg-surface-card transition-colors"
                >
                  <span className="font-display text-xs text-dark-base">
                    {selectedFormat.label}
                    <span className="text-dark-muted"> · {selectedFormat.ratio} · {selectedFormat.dimensions}</span>
                  </span>
                  <ChevronDown
                    className={`w-3 h-3 text-dark-muted transition-transform ${formatMenuOpen ? 'rotate-180' : ''}`}
                    strokeWidth={1.5}
                  />
                </button>

                {formatMenuOpen && (
                  <>
                    {/* Click-away backdrop — closes without a global listener */}
                    <div className="fixed inset-0 z-10" onClick={() => setFormatMenuOpen(false)} />
                    <ul
                      role="listbox"
                      className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-y-auto bg-surface-card border border-surface-border rounded-lg shadow-card py-1"
                    >
                      {VISUAL_FORMATS.map((f) => (
                        <li key={f.id}>
                          <button
                            type="button"
                            onClick={() => { setFormatId(f.id); setFormatMenuOpen(false); }}
                            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface-elevated transition-colors"
                          >
                            <span className="font-display text-[13px] text-dark-base">{f.label}</span>
                            <span className="font-mono text-[10px] text-dark-muted flex-shrink-0">{f.ratio} · {f.dimensions}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </>
          )}

          {/* Tone */}
          <div className="section-label mb-2.5">Voice & tone</div>
          <div className="relative mb-4.5">
            <button
              type="button"
              onClick={() => setToneMenuOpen((open) => !open)}
              aria-haspopup="listbox"
              aria-expanded={toneMenuOpen}
              className="w-full flex items-center justify-between p-2.5 bg-surface-elevated border border-surface-border rounded-lg hover:bg-surface-card transition-colors"
            >
              <span className="font-display text-xs text-dark-base">
                {tone}
                {usingOnboardingTone && <span className="text-dark-muted"> · from onboarding</span>}
              </span>
              <ChevronDown
                className={`w-3 h-3 text-dark-muted transition-transform ${toneMenuOpen ? 'rotate-180' : ''}`}
                strokeWidth={1.5}
              />
            </button>

            {toneMenuOpen && (
              <>
                {/* Click-away backdrop — closes without a global listener */}
                <div className="fixed inset-0 z-10" onClick={() => setToneMenuOpen(false)} />
                <ul
                  role="listbox"
                  className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-y-auto bg-surface-card border border-surface-border rounded-lg shadow-card py-1"
                >
                  {TONES.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => { setToneOverride(t.label); setToneMenuOpen(false); }}
                        className="w-full text-left px-3 py-2 hover:bg-surface-elevated transition-colors"
                      >
                        <div className="font-display text-[13px] text-dark-base">{t.label}</div>
                        <div className="font-mono text-[10px] text-dark-muted">{t.sub}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {/* Soft hint — never a hard gate: generation works without a product. */}
          {!product.trim() && contextCampaign && (
            <p className="font-mono text-[10px] text-dark-muted text-center mb-2">
              Tip: add a product or service for more specific copy.
            </p>
          )}

          <button
            onClick={generate}
            disabled={phase === 'generating'}
            aria-label={phase === 'generating' ? 'Generating content, please wait' : 'Generate content'}
            className="w-full flex items-center justify-center gap-2 px-4.5 py-3.5 bg-lumi-accent hover:bg-lumi-accent/90 text-white rounded-lg transition-all duration-150 font-display font-semibold text-sm shadow-accent-glow disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lumi-accent focus:ring-offset-2 focus:ring-offset-surface-dark"
          >
            <Sparkles className="w-4 h-4" strokeWidth={1.5} />
            {phase === 'generating' ? 'Generating…' : 'Generate'}
            {phase !== 'generating' && <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.5} />}
          </button>

        </aside>

        {/* MIDDLE: History rail */}
        <HistoryRail
          generations={generations}
          isLoading={historyLoading}
          error={historyError}
          activeId={viewingId}
          onSelect={(gen) => setViewingId(gen.id)}
          multiUser={multiUser}
        />

        {/* RIGHT: Output */}
        <main>
          {viewing ? (
            <div className="flex flex-col gap-3">
              {/* Historical badge + metadata — the user always knows this is saved,
                  not the live generation. */}
              <div className="flex items-center justify-between gap-2 p-2.5 bg-lumi-accent/5 border border-lumi-accent/25 rounded-lg">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="px-1.5 py-0.5 rounded bg-lumi-accent/15 text-lumi-accent font-mono text-[9px] font-semibold tracking-wider flex-shrink-0">
                    HISTORICAL
                  </span>
                  <span className="font-mono text-[11px] text-dark-muted truncate">
                    {viewing.context?.campaignContext?.name || 'General brief'} · {relTime(viewing.createdAt)}
                    {multiUser && viewing.createdBy?.email ? ` · ${viewing.createdBy.email}` : ''}
                  </span>
                </div>
                <button
                  onClick={() => setViewingId(null)}
                  className="flex-shrink-0 font-mono text-[11px] text-lumi-accent hover:underline"
                >
                  Back to live
                </button>
              </div>
              <OutputDone
                content={viewing.content}
                opts={vOpts}
                tone={vTone}
                contextCampaign={vCampaign}
                workspace={workspace}
                onRegenerate={() => regenerateFromHistory(viewing)}
              />
            </div>
          ) : (
            <>
              {phase === 'idle' && <OutputEmpty />}
              {phase === 'generating' && <OutputGenerating />}
              {phase === 'error' && <OutputError error={apiError} onRetry={reset} />}
              {phase === 'done' && (
                <OutputDone
                  content={content}
                  opts={opts}
                  tone={tone}
                  contextCampaign={contextCampaign}
                  workspace={workspace}
                  onRegenerate={reset}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Learning History — placeholder for the forthcoming creative-learning loop.
          No data source yet; an honest "coming soon", never a fabricated list. */}
      <div className="mt-4">
        <div className="bg-surface-card border border-surface-border rounded-xl p-4 shadow-card">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-display font-bold text-[13px] text-dark-base">
              Creative learning history
            </span>
            <span className="px-1.5 py-0.5 rounded bg-surface-elevated text-dark-muted font-mono text-[9px] font-semibold tracking-wider">
              Coming soon
            </span>
          </div>
          <p className="text-[13px] text-dark-soft leading-relaxed">
            Lumi will learn from your creative decisions — which hooks landed, which CTAs
            underperformed, and what patterns predict success on your account.
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MARCOM — Content Lab Page
// ============================================================
// Two-panel layout: left = input/controls, right = generated output.
// Generates on-brand copy, headlines, CTAs, visual briefs, video scripts.
// ============================================================
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Send, X, ChevronDown, AlertTriangle, Sparkles, ArrowRight,
} from 'lucide-react';
import { useWorkspace } from '@/hooks/useWorkspace.js';
import { useContentGeneration } from '@/hooks/useContentGeneration.js';
import { useConnectorCampaigns } from '@/hooks/useConnectorCampaigns.js';
import { useOnboardingContext } from '@/hooks/useOnboardingContext.js';
import { TONES } from '@/pages/OnboardingPage/constants.js';
import { resolveBrandContext } from './brandContext.js';
import { VISUAL_FORMATS, DEFAULT_FORMAT_ID, formatById, formatToPromptFields } from './visualFormats.js';
import { OutputEmpty, OutputGenerating, OutputDone, OutputError } from './OutputComponents.jsx';
import { OptToggle } from './OptToggle.jsx';

export default function ContentLabView() {
  const navigate = useNavigate();
  const { workspace } = useWorkspace();
  const { context: onboarding } = useOnboardingContext();
  // Live connector campaigns (MetricSnapshot-backed entity graph), NOT the
  // legacy CampaignState feed — so "Sync Live Meta" campaigns are selectable.
  const { campaigns, loading: campaignsLoading } = useConnectorCampaigns();
  const {
    generate: generateContent,
    content,
    loading,
    error: apiError,
    progress: apiProgress,
    reset: resetGeneration,
  } = useContentGeneration();

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

  const tone = toneOverride ?? brand.toneLabel ?? 'Warm & familial';
  const usingOnboardingTone = toneOverride == null && !!brand.toneLabel;
  const selectedFormat = formatById(formatId);

  // Derive phase from hook state
  const phase = loading ? 'generating' : apiError ? 'error' : content ? 'done' : 'idle';
  const progress = apiProgress;

  const generate = async () => {
    await generateContent({
      campaignContext: contextCampaign ? {
        name: contextCampaign.campaign,
        adset: contextCampaign.adset,
        // Ground generation in the campaign's REAL diagnosis + CTR (or omit
        // them) — never a hardcoded "CTR fell 36%" the campaign never produced.
        problem: contextCampaign.diagnosis || undefined,
        ctr: contextCampaign.ctr ?? undefined,
      } : null,
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
  };

  const reset = () => {
    resetGeneration();
  };

  const problem = contextCampaign
    ? {
        tag:  contextCampaign.tag || 'DIAGNOSIS',
        body: contextCampaign.diagnosis || 'No per-campaign diagnosis — generation uses your brand voice plus the account’s live campaign performance.',
      }
    : { tag: 'NO CONTEXT', body: 'Select a campaign to focus this piece on it — live performance is included either way.' };

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      {/* Header */}
      <header className="mb-5">
        <div className="font-mono text-[11px] tracking-[0.08em] uppercase text-dark-muted mb-2 flex items-center gap-2">
          <Send className="w-3.5 h-3.5 text-lumi-accent" strokeWidth={1.5} />
          Content Lab · Module 03
        </div>
        <h1 className="font-display font-bold text-[30px] tracking-tight text-dark-base">
          Fix the bleed. Generate on-brand copy + visuals.
        </h1>
      </header>

      {/* Two-panel layout - responsive: stack on mobile, side-by-side on lg+ */}
      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-4">
        {/* LEFT: Input & Controls - sticky on desktop only */}
        <aside className="bg-surface-card border border-surface-border rounded-xl p-5 shadow-card self-start lg:sticky lg:top-6">
          <div className="section-label mb-3">Campaign context</div>

          {contextCampaign ? (
            <div className="relative p-3.5 bg-lumi-accent/6 border border-lumi-accent/30 rounded-lg mb-3.5">
              <button
                onClick={() => setContextCampaign(null)}
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
                                campaign:  c.name,
                                adset:     c.channel,
                                diagnosis: null,
                                tag:       null,
                                ctr:       c.ctr != null ? +(c.ctr * 100).toFixed(2) : null,
                              });
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

          {/* Problem detected */}
          <div className="flex gap-2.5 p-3 bg-surface-elevated rounded-lg mb-4.5">
            <AlertTriangle
              className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${contextCampaign ? 'text-signal-kill' : 'text-dark-subtle'}`}
              strokeWidth={1.5}
            />
            <div className="flex-1 min-w-0">
              <div className={`font-mono text-[10px] font-semibold tracking-[0.08em] uppercase ${contextCampaign ? 'text-signal-kill' : 'text-dark-muted'}`}>
                Problem · {problem.tag}
              </div>
              <div className="text-[11px] text-dark-soft mt-1 leading-relaxed">
                {problem.body}
              </div>
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
              onToggle={() => setOpts({ ...opts, video: !opts.video })}
              label="Video script"
              sub="Higgsfield"
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

          {phase === 'generating' && (
            <div className="mt-3 h-0.5 rounded-sm bg-surface-border overflow-hidden">
              <div
                className="h-full w-1/3 bg-lumi-accent animate-progress-sweep"
              />
            </div>
          )}
        </aside>

        {/* RIGHT: Output */}
        <main>
          {phase === 'idle' && <OutputEmpty />}
          {phase === 'generating' && <OutputGenerating progress={progress} />}
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
        </main>
      </div>
    </div>
  );
}

// ============================================================
// MARCOM — Content Lab Page
// ============================================================
// Two-panel layout: left = input/controls, right = generated output.
// Generates on-brand copy, headlines, CTAs, visual briefs, video scripts.
// ============================================================
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Send, X, ChevronDown, AlertTriangle, Sparkles, ArrowRight,
} from 'lucide-react';
import { useWorkspace } from '@/hooks/useWorkspace.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { useContentGeneration } from '@/hooks/useContentGeneration.js';
import { useCampaignFeed } from '@/hooks/useCampaignFeed.js';
import { OutputEmpty, OutputGenerating, OutputDone, OutputError } from './OutputComponents.jsx';
import { OptToggle } from './OptToggle.jsx';

export default function ContentLabView() {
  const navigate = useNavigate();
  const { workspace } = useWorkspace();
  const { currentUser } = useAuth();
  const { campaigns } = useCampaignFeed();
  const {
    generate: generateContent,
    content,
    loading,
    error: apiError,
    progress: apiProgress,
    reset: resetGeneration,
  } = useContentGeneration();

  const [opts, setOpts] = useState({
    copy: true,
    headlines: true,
    cta: true,
    visual: true,
    video: false,
  });
  const [tone, setTone] = useState('Warm & familial');
  const [contextCampaign, setContextCampaign] = useState(null);
  const [campaignMenuOpen, setCampaignMenuOpen] = useState(false);

  // Derive phase from hook state
  const phase = loading ? 'generating' : apiError ? 'error' : content ? 'done' : 'idle';
  const progress = apiProgress;

  const generate = async () => {
    // Extract brand voice from user context (from onboarding)
    const brandVoice = currentUser?.context?.brandVoice || workspace?.brandVoice || 'Professional, clear, action-oriented';

    await generateContent({
      campaignContext: contextCampaign ? {
        name: contextCampaign.campaign,
        adset: contextCampaign.adset,
        problem: 'Hook is not engaging in the first 3 seconds. CTR fell 36% in 48h.',
      } : null,
      options: opts,
      tone,
      brandVoice,
    });
  };

  const reset = () => {
    resetGeneration();
  };

  const problem = contextCampaign
    ? { tag: 'CREATIVE_FATIGUE', body: 'Hook is not engaging in the first 3 seconds. CTR fell 36% in 48h.' }
    : { tag: 'NO CONTEXT', body: 'Select a campaign to ground generation in real diagnosis.' };

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
                    {campaigns.length === 0 ? (
                      <li>
                        <button
                          type="button"
                          onClick={() => { setCampaignMenuOpen(false); navigate('/app/campaigns'); }}
                          className="w-full text-left px-3 py-2.5 hover:bg-surface-elevated transition-colors"
                        >
                          <span className="font-display text-[13px] text-dark-soft">
                            No campaigns yet — open Campaigns
                          </span>
                        </button>
                      </li>
                    ) : (
                      campaigns.map((c) => (
                        <li key={c.campaign_id}>
                          <button
                            type="button"
                            onClick={() => {
                              setContextCampaign({ campaign: c.campaign_id, adset: c.stage });
                              setCampaignMenuOpen(false);
                            }}
                            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-surface-elevated transition-colors"
                          >
                            <span className="font-display text-[13px] text-dark-base truncate">
                              {c.campaign_id}
                            </span>
                            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-dark-muted flex-shrink-0">
                              {c.stage}
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

          {/* Tone */}
          <div className="section-label mb-2.5">Voice & tone</div>
          <button className="w-full flex items-center justify-between p-2.5 bg-surface-elevated border border-surface-border rounded-lg hover:bg-surface-card transition-colors mb-4.5">
            <span className="font-display text-xs text-dark-base">
              {tone} <span className="text-dark-muted">· from onboarding</span>
            </span>
            <ChevronDown className="w-3 h-3 text-dark-muted" strokeWidth={1.5} />
          </button>

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

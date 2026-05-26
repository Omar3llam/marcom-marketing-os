// ============================================================
// MARCOM Content Lab — Output Components
// ============================================================
// Output states and cards for the Content Lab generation UI.
// ============================================================
import { useState } from 'react';
import {
  Sparkles, Check, RotateCcw, FileText, Zap, Layers, Play,
  Database, ArrowUpRight, AlertTriangle,
} from 'lucide-react';
import LumiLoader from '@/components/ui/LumiLoader.jsx';

// ── Empty state ──────────────────────────────────────────────
export function OutputEmpty() {
  return (
    <div className="min-h-[480px] flex flex-col items-center justify-center p-10 bg-surface-card border border-dashed border-surface-border-strong rounded-xl text-center">
      <div className="w-14 h-14 rounded-xl bg-lumi-accent/10 text-lumi-accent flex items-center justify-center mb-4">
        <Sparkles className="w-6.5 h-6.5" strokeWidth={1.5} />
      </div>
      <div className="font-display font-bold text-lg text-dark-base">Pick what to generate</div>
      <p className="mt-2 text-[13px] text-dark-soft max-w-[380px] leading-relaxed">
        Lumi will draft copy + visuals grounded in your brand voice, dialect, and the campaign&apos;s diagnosed problem.
      </p>
    </div>
  );
}

// ── Generating state ─────────────────────────────────────────
export function OutputGenerating({ progress }) {
  const steps = ['Reading diagnosis', 'Loading brand voice', 'Drafting copy', 'Composing visuals', 'Pressure-testing'];
  const activeIdx = Math.min(steps.length - 1, Math.floor((progress / 100) * steps.length));

  return (
    <div className="bg-surface-card border border-surface-border rounded-xl p-8 min-h-[480px] flex flex-col items-center justify-center text-center shadow-card">
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        Generating content: {Math.floor(progress)}% complete. Current step: {steps[activeIdx]}
      </div>
      <LumiLoader label="Generating" sub={`${Math.floor(progress)}%`} />
      <div className="mt-7 flex flex-col gap-2">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <span className="w-3.5 flex justify-center">
              {i < activeIdx ? (
                <Check className="w-3 h-3 text-signal-scale" strokeWidth={2} />
              ) : i === activeIdx ? (
                <span className="w-2 h-2 rounded-full bg-lumi-accent animate-pulse" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full border border-dark-subtle" />
              )}
            </span>
            <span className={`font-mono text-xs ${i <= activeIdx ? 'text-dark-base' : 'text-dark-subtle'}`}>
              {s}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Error state ──────────────────────────────────────────────
export function OutputError({ error, onRetry }) {
  return (
    <div className="min-h-[480px] flex flex-col items-center justify-center p-10 bg-surface-card border border-surface-border rounded-xl text-center">
      <div className="w-14 h-14 rounded-xl bg-signal-kill-bg text-signal-kill flex items-center justify-center mb-4">
        <AlertTriangle className="w-6.5 h-6.5" strokeWidth={1.5} />
      </div>
      <div className="font-display font-bold text-lg text-dark-base mb-2">
        Generation failed
      </div>
      <p className="text-[13px] text-dark-soft max-w-[380px] leading-relaxed mb-4">
        {error || 'Something went wrong while generating content. Please try again.'}
      </p>
      <button
        onClick={onRetry}
        className="flex items-center gap-2 px-4 py-2.5 bg-lumi-accent hover:bg-lumi-accent/90 text-white rounded-lg transition-all font-display font-semibold text-sm shadow-accent-glow"
      >
        <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.5} />
        Try again
      </button>
    </div>
  );
}

// ── Output done ──────────────────────────────────────────────
export function OutputDone({ content, opts, tone, contextCampaign, onRegenerate }) {
  // Use real content from API, fallback to mock data for demo
  const COPY_VARIANTS = content?.copy || [
    { tag: 'STORY', text: 'Built for operators who can\'t afford to "let it run." Verdicts in 18s, with the cash impact pinned.' },
    { tag: 'PROOF', text: '240 MENA workspaces trust Lumi to make the call. Join them — first verdict free.' },
    { tag: 'URGENCY', text: 'Stop bleeding ad sets today. The first scan takes 18 seconds.' },
  ];
  const HEADLINES = content?.headlines || ['Built for operators.', 'Verdicts in 18 seconds.', 'Stop the bleed today.'];
  const CTAS = content?.ctas || ['Get your first verdict', 'Scan my campaigns', 'Stop the bleed'];
  const VISUAL_BRIEF = content?.visual || 'Square crop. Warm desert palette — terracotta, sand, deep gold. A pair of hands cradling folded fabric in soft natural light, golden hour. Hand-stitched detail visible. Background subtle, out of focus. Editorial feel, not stock. No model face — focus on craft.';
  const VIDEO_SCRIPT = content?.video || `HOOK (0-3s): Slow pull-focus on hands stitching. Sound of needle through fabric.
PROBLEM (3-7s): Cut to dusty street, fast fashion bag dropping in mud.
PROMISE (7-11s): Cut back to Maison Salam atelier. Soft gold light.
PROOF (11-15s): Quick montage — 3,400 women, Cairo to Madinah.
CTA (15-18s): "Final 200 pieces · Eid only" — gold text on warm background.`;

  return (
    <div className="flex flex-col gap-3.5">
      {/* Success banner */}
      <div className="flex items-center justify-between p-3 bg-signal-scale-bg border border-signal-scale/25 rounded-lg">
        <div className="flex items-center gap-2.5">
          <Check className="w-3.5 h-3.5 text-signal-scale" strokeWidth={2} />
          <span className="font-display font-semibold text-[13px] text-dark-base">
            Generated · grounded in {tone}
          </span>
        </div>
        <button
          onClick={onRegenerate}
          className="flex items-center gap-1.5 px-3 py-1.5 text-dark-soft hover:text-dark-base hover:bg-surface-elevated rounded-lg transition-colors text-[11px] font-display font-medium"
        >
          <RotateCcw className="w-2.5 h-2.5" strokeWidth={1.5} />
          Regenerate
        </button>
      </div>

      {/* Output cards */}
      {opts.copy && (
        <OutputCard title="Copy variants" Icon={FileText} count={`${COPY_VARIANTS.length} options`}>
          <div className="space-y-2">
            {COPY_VARIANTS.map((c, i) => (
              <CopyRow key={i} tag={c.tag} text={c.text} />
            ))}
          </div>
        </OutputCard>
      )}

      {opts.headlines && (
        <OutputCard title="Headlines" Icon={Zap} count="3 options">
          <div className="space-y-1.5">
            {HEADLINES.map((h, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-3 p-2.5 bg-surface-elevated border border-surface-border rounded-lg"
              >
                <span className="font-display font-semibold text-[15px] tracking-tight text-dark-base">
                  {h}
                </span>
                <button className="px-2.5 py-1 text-dark-soft hover:text-dark-base hover:bg-surface-card rounded transition-colors text-[11px] font-display font-medium">
                  Copy
                </button>
              </div>
            ))}
          </div>
        </OutputCard>
      )}

      {opts.cta && (
        <OutputCard title="CTAs" Icon={Play} count="3 variants">
          <div className="flex flex-wrap gap-2">
            {CTAS.map((cta, i) => (
              <span
                key={i}
                className="px-3.5 py-2 bg-lumi-accent text-white rounded-lg font-display font-bold text-[13px] shadow-accent-glow"
              >
                {cta}
              </span>
            ))}
          </div>
        </OutputCard>
      )}

      {opts.visual && (
        <OutputCard title="Visual brief" Icon={Layers} count="DALL·E ready">
          <p className="text-[13px] text-dark-soft leading-relaxed mb-3">
            {VISUAL_BRIEF}
          </p>
          <div className="flex gap-2">
            <button className="flex items-center gap-2 px-4 py-2.5 bg-lumi-accent hover:bg-lumi-accent/90 text-white rounded-lg transition-all font-display font-semibold text-[13px] shadow-accent-glow">
              <Sparkles className="w-3.5 h-3.5" strokeWidth={1.5} />
              Generate image · DALL·E
            </button>
            <button className="px-3.5 py-2.5 text-dark-soft hover:text-dark-base hover:bg-surface-elevated rounded-lg transition-colors text-[13px] font-display font-medium">
              Copy prompt
            </button>
          </div>
        </OutputCard>
      )}

      {opts.video && (
        <OutputCard title="Video brief" Icon={Play} count="Higgsfield">
          <pre className="p-3.5 bg-surface-elevated border border-surface-border rounded-lg text-xs text-dark-soft whitespace-pre-wrap font-mono leading-relaxed">
{VIDEO_SCRIPT}
          </pre>
          <div className="mt-2.5 flex gap-2">
            <button className="flex items-center gap-2 px-4 py-2.5 bg-lumi-accent hover:bg-lumi-accent/90 text-white rounded-lg transition-all font-display font-semibold text-[13px] shadow-accent-glow">
              <ArrowUpRight className="w-3.5 h-3.5" strokeWidth={1.5} />
              Open in Higgsfield
            </button>
            <button className="px-3.5 py-2.5 text-dark-soft hover:text-dark-base hover:bg-surface-elevated rounded-lg transition-colors text-[13px] font-display font-medium">
              Copy prompt
            </button>
          </div>
        </OutputCard>
      )}

      {/* Bottom actions */}
      <div className="flex gap-2.5 p-3.5 bg-surface-card border border-surface-border rounded-xl shadow-card sticky bottom-6 mt-1">
        <button className="flex-1 flex items-center justify-center gap-2 px-3.5 py-3 bg-lumi-accent hover:bg-lumi-accent/90 text-white rounded-lg transition-all font-display font-semibold text-sm shadow-accent-glow">
          <Database className="w-3.5 h-3.5" strokeWidth={1.5} />
          Save to {contextCampaign?.campaign || 'campaign'}
        </button>
        <button className="flex items-center gap-2 px-4 py-2.5 text-dark-soft hover:text-dark-base hover:bg-surface-elevated rounded-lg transition-colors text-[13px] font-display font-medium">
          <FileText className="w-3.5 h-3.5" strokeWidth={1.5} />
          Export
        </button>
      </div>
    </div>
  );
}

function OutputCard({ title, Icon, count, children }) {
  return (
    <div className="bg-surface-card border border-surface-border rounded-xl p-4 shadow-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5 text-lumi-accent" strokeWidth={1.5} />
          <span className="font-display font-bold text-[13px] text-dark-base">{title}</span>
        </div>
        <span className="font-mono text-[10px] text-dark-subtle tracking-wider">{count}</span>
      </div>
      {children}
    </div>
  );
}

function CopyRow({ tag, text }) {
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="flex items-start gap-2.5 p-3 bg-surface-elevated border border-surface-border rounded-lg">
      <span className="px-1.5 py-0.5 rounded bg-lumi-accent/10 text-lumi-accent font-mono text-[9px] font-semibold tracking-wider flex-shrink-0 mt-0.5">
        {tag}
      </span>
      <span className="flex-1 text-[13px] text-dark-soft leading-relaxed">{text}</span>
      <button
        onClick={onCopy}
        className="px-2.5 py-1 text-dark-soft hover:text-dark-base hover:bg-surface-card rounded transition-colors text-[11px] font-display font-medium flex-shrink-0"
      >
        {copied ? (
          <>
            <Check className="inline w-2.5 h-2.5 mr-1" strokeWidth={2} />
            Copied
          </>
        ) : (
          'Copy'
        )}
      </button>
    </div>
  );
}

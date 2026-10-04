// ============================================================
// MARCOM Content Lab — Output Components
// ============================================================
// Output states and cards for the Content Lab generation UI.
// ============================================================
import { useState } from 'react';
import {
  Sparkles, Check, RotateCcw, FileText, Zap, Layers, Play,
  AlertTriangle, Target,
} from 'lucide-react';

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
export function OutputGenerating() {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="bg-surface-card border border-surface-border rounded-xl p-8 min-h-[480px] flex flex-col items-center justify-center text-center shadow-card">
      <p className="font-display font-bold text-lg text-dark-base">Generating content…</p>
      <p className="mt-2 text-[13px] text-dark-soft">Waiting for this request to finish.</p>
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
export function OutputDone({ content, opts, tone, onRegenerate }) {
  // Honest sourcing: a section is null when the request was made but generation
  // produced nothing. We render a per-section "couldn't generate" — NEVER another
  // brand's canned copy. Generations are auto-saved to history on the server.
  const COPY_VARIANTS = content?.copy ?? null;
  const HEADLINES = content?.headlines ?? null;
  const CTAS = content?.ctas ?? null;
  const VISUAL_BRIEF = content?.visual ?? null;

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

      {/* Creative strategy — one frame for the whole set, from the first copy
          variant. Rendered only when present (older generations won't have it). */}
      {content?.strategy && (
        <div className="bg-surface-card border border-surface-border rounded-xl p-4 shadow-card">
          <div className="flex items-center gap-2 mb-1">
            <Target className="w-3.5 h-3.5 text-lumi-accent" strokeWidth={1.5} />
            <span className="font-display font-bold text-[13px] text-dark-base">Creative strategy</span>
          </div>
          <p className="text-[11px] text-dark-subtle leading-relaxed mb-3">
            Generated from the campaign diagnosis and your brief.
          </p>
          <div className="space-y-2">
            {[
              { label: 'Objective', value: content.strategy.objective },
              { label: 'Core message', value: content.strategy.core_message },
              { label: 'Hook', value: content.strategy.hook },
              { label: 'Visual', value: content.strategy.visual },
              { label: 'CTA', value: content.strategy.cta_direction },
            ].filter((row) => row.value).map(({ label, value }) => (
              <div key={label} className="flex gap-3">
                <span className="w-24 shrink-0 pt-0.5 font-mono text-[10px] uppercase tracking-wider text-dark-subtle">
                  {label}
                </span>
                <span className="flex-1 text-[13px] text-dark-soft leading-relaxed">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Output cards */}
      {opts.copy && (
        <OutputCard title="Copy variants" Icon={FileText} count={COPY_VARIANTS?.length ? `${COPY_VARIANTS.length} options` : '—'}>
          {COPY_VARIANTS?.length ? (
            <div className="space-y-2">
              {COPY_VARIANTS.map((c, i) => (
                <CopyRow key={i} tag={c.tag} text={c.text} />
              ))}
            </div>
          ) : (
            <SectionEmpty label="copy" />
          )}
        </OutputCard>
      )}

      {opts.headlines && (
        <OutputCard title="Headlines" Icon={Zap} count={HEADLINES?.length ? `${HEADLINES.length} options` : '—'}>
          {HEADLINES?.length ? (
            <div className="space-y-1.5">
              {HEADLINES.map((h, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 p-2.5 bg-surface-elevated border border-surface-border rounded-lg"
                >
                  <span className="font-display font-semibold text-[15px] tracking-tight text-dark-base">
                    {h}
                  </span>
                  <CopyButton
                    text={h}
                    className="px-2.5 py-1 text-dark-soft hover:text-dark-base hover:bg-surface-card rounded transition-colors text-[11px] font-display font-medium flex-shrink-0"
                  />
                </div>
              ))}
            </div>
          ) : (
            <SectionEmpty label="headlines" />
          )}
        </OutputCard>
      )}

      {opts.cta && (
        <OutputCard title="CTAs" Icon={Play} count={CTAS?.length ? `${CTAS.length} variants` : '—'}>
          {CTAS?.length ? (
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
          ) : (
            <SectionEmpty label="CTAs" />
          )}
        </OutputCard>
      )}

      {opts.visual && (
        <OutputCard title="Visual brief" Icon={Layers} count={VISUAL_BRIEF ? 'brief' : '—'}>
          {VISUAL_BRIEF ? (
            <>
              <p className="text-[13px] text-dark-soft leading-relaxed mb-3">
                {VISUAL_BRIEF}
              </p>
              <div className="flex gap-2">
                <CopyButton
                  text={VISUAL_BRIEF}
                  label="Copy prompt"
                  className="px-3.5 py-2.5 text-dark-soft hover:text-dark-base hover:bg-surface-elevated rounded-lg transition-colors text-[13px] font-display font-medium"
                />
              </div>
            </>
          ) : (
            <SectionEmpty label="a visual brief" />
          )}
        </OutputCard>
      )}

      {opts.video && (
        <OutputCard title="Video brief" Icon={Play} count="Coming soon">
          <p className="text-[13px] text-dark-soft leading-relaxed">
            Video generation is coming soon.
          </p>
        </OutputCard>
      )}
    </div>
  );
}

// Honest per-section empty — shown when a requested section produced nothing.
// Never a cross-brand fallback: the user sees the truth and can regenerate.
function SectionEmpty({ label }) {
  return (
    <p className="text-[13px] text-dark-soft leading-relaxed">
      Lumi couldn&apos;t generate {label} for this request. Try adjusting your brief or generate again.
    </p>
  );
}

// Copy-to-clipboard button with a brief "Copied" confirmation. Reused by the
// headline rows and the visual-brief prompt.
function CopyButton({ text, label = 'Copy', className }) {
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <button onClick={onCopy} className={className}>
      {copied ? (
        <>
          <Check className="inline w-2.5 h-2.5 mr-1" strokeWidth={2} />
          Copied
        </>
      ) : (
        label
      )}
    </button>
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

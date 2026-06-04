// ============================================================
// Lumi — Content Lab
// ============================================================
// Two-panel layout: left = input/controls, right = generated.
// Optionally pre-loaded with a campaign context.
// ============================================================

import { Icons } from './icons.jsx';
import { LumiLoader } from './primitives.jsx';

export function ContentLab({ workspace, contextCampaign, onClearContext, onNav }) {
  const [opts, setOpts] = React.useState({
    copy: true,
    headlines: true,
    cta: true,
    visual: true,
    video: false,
  });
  const [tone, setTone] = React.useState('Warm & familial');
  const [phase, setPhase] = React.useState(contextCampaign ? 'idle' : 'idle'); // idle | generating | done
  const [progress, setProgress] = React.useState(0);

  const generate = () => {
    setPhase('generating');
    setProgress(0);
    let p = 0;
    const id = setInterval(() => {
      p += 7 + Math.random() * 10;
      if (p >= 100) { p = 100; clearInterval(id); setPhase('done'); }
      setProgress(p);
    }, 80);
  };

  const reset = () => { setPhase('idle'); setProgress(0); };

  const problem = contextCampaign
    ? { tag: 'CREATIVE_FATIGUE', body: 'Hook is not engaging in the first 3 seconds. CTR fell 36% in 48h.' }
    : { tag: 'NO CONTEXT', body: 'Select a campaign on the left to ground generation in real diagnosis.' };

  return (
    <div data-screen-label="Content Lab" style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 32px 24px' }}>
      <header style={{ marginBottom: 20 }}>
        <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icons.Send style={{ fontSize: 13, color: 'var(--c-gold)' }} />
          Content Lab · Module 03
        </div>
        <h1 className="font-display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, color: 'var(--c-text-base)' }}>
          Fix the bleed. Generate on-brand copy + visuals.
        </h1>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: 16 }}>
        {/* ── LEFT: Input & Controls ───────────────────── */}
        <aside style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, padding: 20, boxShadow: 'var(--sh-card)', alignSelf: 'flex-start', position: 'sticky', top: 24 }}>
          <div className="section-label" style={{ marginBottom: 12 }}>Campaign context</div>

          {contextCampaign ? (
            <div style={{
              padding: '12px 14px',
              background: 'rgba(246,201,69,0.06)',
              border: '1px solid rgba(246,201,69,0.30)',
              borderRadius: 10,
              marginBottom: 14,
              position: 'relative',
            }}>
              <button onClick={onClearContext} style={{ position: 'absolute', top: 8, right: 8, background: 'transparent', border: 'none', color: 'var(--c-text-muted)', cursor: 'pointer', padding: 2, display: 'flex' }}>
                <Icons.X style={{ fontSize: 12 }} />
              </button>
              <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-gold-deep)', marginBottom: 4 }}>
                Pre-loaded from Campaigns
              </div>
              <div className="font-display" style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-base)', paddingRight: 16 }}>
                {contextCampaign.campaign}
              </div>
              <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 2 }}>
                {contextCampaign.adset}
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: 14 }}>
              <button
                onClick={() => onNav('campaigns')}
                style={{
                  width: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 14px',
                  background: 'var(--c-surface-elevated)',
                  border: '1px solid var(--c-surface-border)',
                  borderRadius: 10, cursor: 'pointer',
                  fontFamily: 'var(--f-display)', fontSize: 13, color: 'var(--c-text-soft)',
                }}
              >
                Select a campaign…
                <Icons.ChevronDown style={{ fontSize: 13 }} />
              </button>
            </div>
          )}

          {/* Problem detected */}
          <div style={{ display: 'flex', gap: 10, padding: '10px 12px', background: 'var(--c-surface-elevated)', borderRadius: 8, marginBottom: 18, alignItems: 'flex-start' }}>
            <Icons.AlertTriangle style={{ fontSize: 14, color: contextCampaign ? 'var(--c-kill)' : 'var(--c-text-subtle)', marginTop: 2 }} />
            <div>
              <div className="font-mono" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: contextCampaign ? 'var(--c-kill-text)' : 'var(--c-text-muted)' }}>
                Problem · {problem.tag}
              </div>
              <div style={{ fontSize: 11, color: 'var(--c-text-soft)', marginTop: 3, lineHeight: 1.5 }}>
                {problem.body}
              </div>
            </div>
          </div>

          {/* Generate options */}
          <div className="section-label" style={{ marginBottom: 10 }}>Generate</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
            <OptToggle on={opts.copy}      onToggle={() => setOpts({ ...opts, copy: !opts.copy })}           label="Ad copy variants"     sub="3 angles" />
            <OptToggle on={opts.headlines} onToggle={() => setOpts({ ...opts, headlines: !opts.headlines })} label="Headlines"            sub="3 options" />
            <OptToggle on={opts.cta}       onToggle={() => setOpts({ ...opts, cta: !opts.cta })}             label="CTA options"          sub="3 variants" />
            <OptToggle on={opts.visual}    onToggle={() => setOpts({ ...opts, visual: !opts.visual })}       label="Visual brief"         sub="DALL·E ready" />
            <OptToggle on={opts.video}     onToggle={() => setOpts({ ...opts, video: !opts.video })}         label="Video script"         sub="Higgsfield" />
          </div>

          {/* Tone */}
          <div className="section-label" style={{ marginBottom: 10 }}>Voice & tone</div>
          <button
            style={{
              width: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px',
              background: 'var(--c-surface-elevated)',
              border: '1px solid var(--c-surface-border)',
              borderRadius: 9, cursor: 'pointer',
              fontFamily: 'var(--f-display)', fontSize: 12, color: 'var(--c-text-base)',
              marginBottom: 18,
            }}
          >
            <span>{tone} <span style={{ color: 'var(--c-text-muted)' }}>· from onboarding</span></span>
            <Icons.ChevronDown style={{ fontSize: 12, color: 'var(--c-text-muted)' }} />
          </button>

          <button
            onClick={generate}
            disabled={phase === 'generating'}
            className="btn-gold"
            style={{ width: '100%', justifyContent: 'center', padding: '13px 18px', fontSize: 14, opacity: phase === 'generating' ? 0.6 : 1 }}
          >
            <Icons.Sparkles style={{ fontSize: 16 }} />
            {phase === 'generating' ? 'Generating…' : 'Generate'}
            {phase !== 'generating' && <Icons.ArrowRight style={{ fontSize: 14 }} />}
          </button>

          {phase === 'generating' && (
            <div style={{ marginTop: 12, height: 3, borderRadius: 2, background: 'var(--c-surface-border)', overflow: 'hidden' }}>
              <div style={{ width: `${progress}%`, height: '100%', background: 'var(--c-gold)', transition: 'width 100ms linear' }} />
            </div>
          )}
        </aside>

        {/* ── RIGHT: Output ───────────────────────────── */}
        <main>
          {phase === 'idle' && <OutputEmpty />}
          {phase === 'generating' && <OutputGenerating progress={progress} />}
          {phase === 'done' && (
            <OutputDone
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

// ── Toggle row ───────────────────────────────────────────────
function OptToggle({ on, onToggle, label, sub }) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 10px',
        background: on ? 'rgba(246,201,69,0.04)' : 'transparent',
        border: `1px solid ${on ? 'rgba(246,201,69,0.30)' : 'transparent'}`,
        borderRadius: 8, cursor: 'pointer', textAlign: 'left',
      }}
    >
      <span style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${on ? 'var(--c-gold-deep)' : 'var(--c-surface-border-strong)'}`, background: on ? 'var(--c-gold)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {on && <Icons.Check style={{ fontSize: 11, color: 'var(--c-text-base)', strokeWidth: 3 }} />}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="font-display" style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text-base)' }}>{label}</span>
        <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', marginLeft: 6 }}>{sub}</span>
      </span>
    </button>
  );
}

// ── Empty state ──────────────────────────────────────────────
function OutputEmpty() {
  return (
    <div style={{ height: '100%', minHeight: 480, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, background: 'var(--c-surface-card)', border: '1px dashed var(--c-surface-border-strong)', borderRadius: 14, textAlign: 'center' }}>
      <div style={{ width: 56, height: 56, borderRadius: 14, background: 'rgba(246,201,69,0.10)', color: 'var(--c-gold-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
        <Icons.Sparkles style={{ fontSize: 26 }} />
      </div>
      <div className="font-display" style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-text-base)' }}>Pick what to generate</div>
      <p style={{ marginTop: 8, fontSize: 13, color: 'var(--c-text-soft)', maxWidth: 380 }}>
        Lumi will draft copy + visuals grounded in your brand voice, dialect, and the campaign's diagnosed problem.
      </p>
    </div>
  );
}

// ── Generating state ─────────────────────────────────────────
function OutputGenerating({ progress }) {
  const steps = ['Reading diagnosis', 'Loading brand voice', 'Drafting copy', 'Composing visuals', 'Pressure-testing'];
  const activeIdx = Math.min(steps.length - 1, Math.floor((progress / 100) * steps.length));
  return (
    <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, padding: 32, minHeight: 480, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', boxShadow: 'var(--sh-card)' }}>
      <LumiLoader label="Generating" sub={`${Math.floor(progress)}%`} />
      <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {steps.map((s, i) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 14, display: 'flex', justifyContent: 'center' }}>
              {i < activeIdx ? <Icons.Check style={{ fontSize: 12, color: 'var(--c-scale-text)' }} /> :
                 i === activeIdx ? <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--c-gold)', animation: 'intel-pulse 1.4s ease-in-out infinite' }} /> :
                                   <span style={{ width: 6, height: 6, borderRadius: '50%', border: '1px solid var(--c-text-subtle)' }} />}
            </span>
            <span className="font-mono" style={{ fontSize: 12, color: i <= activeIdx ? 'var(--c-text-base)' : 'var(--c-text-subtle)' }}>{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Output done ──────────────────────────────────────────────
function OutputDone({ opts, tone, contextCampaign, workspace, onRegenerate }) {
  const isModest = workspace.id === 'apparel';
  const COPY_VARIANTS = isModest
    ? [
        { tag: 'STORY',     text: 'Hand-stitched in Cairo. Worn from Mansoura to Madinah. Find your piece — before Eid ends.' },
        { tag: 'PROOF',     text: '3,400 women chose Maison Salam this Ramadan. The Eid drop is closing in 48h.' },
        { tag: 'URGENCY',   text: 'Final 200 pieces. Free EGP delivery. Eid week only.' },
      ]
    : [
        { tag: 'STORY',     text: 'Built for operators who can\'t afford to "let it run." Verdicts in 18s, with the cash impact pinned.' },
        { tag: 'PROOF',     text: '240 MENA workspaces trust Lumi to make the call. Join them — first verdict free.' },
        { tag: 'URGENCY',   text: 'Stop bleeding ad sets today. The first scan takes 18 seconds.' },
      ];
  const HEADLINES = ['Worn from Cairo to Madinah.', 'Hand-stitched. Honest pricing.', 'The Eid drop — closing in 48h.'];
  const CTAS = ['Shop the Eid drop', 'See the collection', 'Get yours before Eid'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icons.Check style={{ fontSize: 14, color: 'var(--c-scale-text)' }} />
          <span className="font-display" style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-base)' }}>Generated · grounded in {tone}</span>
        </div>
        <button onClick={onRegenerate} className="btn-ghost" style={{ padding: '6px 12px', fontSize: 11 }}>
          <Icons.RotateCcw style={{ fontSize: 11 }} />
          Regenerate
        </button>
      </div>

      {opts.copy && (
        <OutputCard title="Copy variants" Icon={Icons.FileText} count={`${COPY_VARIANTS.length} options`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {COPY_VARIANTS.map((c, i) => (
              <CopyRow key={i} tag={c.tag} text={c.text} />
            ))}
          </div>
        </OutputCard>
      )}

      {opts.headlines && (
        <OutputCard title="Headlines" Icon={Icons.Zap} count="3 options">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {HEADLINES.map((h, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px', background: 'var(--c-surface-elevated)', border: '1px solid var(--c-surface-border)', borderRadius: 8 }}>
                <span className="font-display" style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--c-text-base)' }}>{h}</span>
                <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 11 }}>Copy</button>
              </div>
            ))}
          </div>
        </OutputCard>
      )}

      {opts.cta && (
        <OutputCard title="CTAs" Icon={Icons.ArrowRight} count="3 variants">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {CTAS.map((cta, i) => (
              <span key={i} className="font-display" style={{ padding: '8px 14px', background: 'var(--c-gold)', color: 'var(--c-text-base)', borderRadius: 8, fontWeight: 700, fontSize: 13, boxShadow: 'var(--sh-gold-glow)' }}>
                {cta}
              </span>
            ))}
          </div>
        </OutputCard>
      )}

      {opts.visual && (
        <OutputCard title="Visual brief" Icon={Icons.Layers} count="DALL·E ready">
          <p style={{ fontSize: 13, color: 'var(--c-text-soft)', margin: '0 0 12px', lineHeight: 1.6 }}>
            Square crop. Warm desert palette — terracotta, sand, deep gold. A pair of hands cradling folded fabric in soft natural light, golden hour. Hand-stitched detail visible. Background subtle, out of focus. Editorial feel, not stock. No model face — focus on craft.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-gold" style={{ padding: '10px 16px', fontSize: 13 }}>
              <Icons.Sparkles style={{ fontSize: 13 }} />
              Generate image · DALL·E
            </button>
            <button className="btn-ghost" style={{ padding: '10px 14px', fontSize: 13 }}>Copy prompt</button>
          </div>
        </OutputCard>
      )}

      {opts.video && (
        <OutputCard title="Video brief" Icon={Icons.Play} count="Higgsfield">
          <pre style={{ margin: 0, padding: 14, background: 'var(--c-surface-elevated)', border: '1px solid var(--c-surface-border)', borderRadius: 8, fontSize: 12, color: 'var(--c-text-soft)', whiteSpace: 'pre-wrap', fontFamily: 'var(--f-mono)', lineHeight: 1.6 }}>
{`HOOK (0-3s): Slow pull-focus on hands stitching. Sound of needle through fabric.
PROBLEM (3-7s): Cut to dusty street, fast fashion bag dropping in mud.
PROMISE (7-11s): Cut back to Maison Salam atelier. Soft gold light.
PROOF (11-15s): Quick montage — 3,400 women, Cairo to Madinah.
CTA (15-18s): "Final 200 pieces · Eid only" — gold text on warm background.`}
          </pre>
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <button className="btn-gold" style={{ padding: '10px 16px', fontSize: 13 }}>
              <Icons.ArrowUpRight style={{ fontSize: 13 }} />
              Open in Higgsfield
            </button>
            <button className="btn-ghost" style={{ padding: '10px 14px', fontSize: 13 }}>Copy prompt</button>
          </div>
        </OutputCard>
      )}

      {/* Bottom actions */}
      <div style={{ display: 'flex', gap: 10, padding: '14px 18px', background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 12, position: 'sticky', bottom: 24, boxShadow: 'var(--sh-card)', marginTop: 4 }}>
        <button className="btn-gold" style={{ flex: 1, justifyContent: 'center', padding: '12px 14px', fontSize: 14 }}>
          <Icons.Database style={{ fontSize: 14 }} />
          Save to {contextCampaign?.campaign || 'campaign'}
        </button>
        <button className="btn-ghost" style={{ padding: '11px 16px', fontSize: 13 }}>
          <Icons.FileText style={{ fontSize: 13 }} />
          Export
        </button>
      </div>
    </div>
  );
}

function OutputCard({ title, Icon, count, children }) {
  return (
    <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 12, padding: 16, boxShadow: 'var(--sh-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon style={{ fontSize: 13, color: 'var(--c-gold-deep)' }} />
          <span className="font-display" style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text-base)' }}>{title}</span>
        </div>
        <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-subtle)', letterSpacing: '0.06em' }}>{count}</span>
      </div>
      {children}
    </div>
  );
}

function CopyRow({ tag, text }) {
  const [copied, setCopied] = React.useState(false);
  const onCopy = () => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', background: 'var(--c-surface-elevated)', border: '1px solid var(--c-surface-border)', borderRadius: 8 }}>
      <span className="font-mono" style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', padding: '2px 7px', borderRadius: 3, background: 'rgba(246,201,69,0.10)', color: 'var(--c-gold-deep)', flexShrink: 0, marginTop: 1 }}>
        {tag}
      </span>
      <span style={{ flex: 1, fontSize: 13, color: 'var(--c-text-soft)', lineHeight: 1.55 }}>{text}</span>
      <button onClick={onCopy} className="btn-ghost" style={{ padding: '4px 10px', fontSize: 11, flexShrink: 0 }}>
        {copied ? <><Icons.Check style={{ fontSize: 10 }} />Copied</> : 'Copy'}
      </button>
    </div>
  );
}


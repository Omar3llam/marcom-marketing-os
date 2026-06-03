import { Zap, ArrowRight, Skull, Pause, Rocket } from 'lucide-react';
import { useReveal } from './useReveal.js';

export function Hero({ onPrimary }) {
  const kill = <strong className="text-verdict-kill-text font-bold">KILL</strong>;
  const hold = <strong className="text-verdict-hold-text font-bold">HOLD</strong>;
  const scale = <strong className="text-verdict-scale-text font-bold">SCALE</strong>;

  return (
    <section id="top" className="relative pt-20 pb-24 px-4 sm:px-6">
      {/* Faint dot grid background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(rgba(43,43,43,0.05) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          maskImage: 'radial-gradient(ellipse at 50% 30%, black, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 50% 30%, black, transparent 75%)',
        }}
      />
      {/* Gold blob */}
      <div
        className="absolute -top-32 right-[8%] w-[560px] h-[560px] pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(246,201,69,0.18), transparent 65%)',
          filter: 'blur(20px)',
        }}
      />

      <div className="max-w-7xl mx-auto grid lg:grid-cols-[1.05fr_0.95fr] gap-20 items-center relative">
        {/* LEFT */}
        <div>
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-lumi-accent/10 border border-lumi-accent/28 mb-7">
            <span className="w-1.5 h-1.5 rounded-full bg-lumi-accent shadow-gold-glow animate-pulse" />
            <span className="font-mono text-[11px] tracking-[0.1em] uppercase text-lumi-accent font-semibold">
              New · Lumi v4.3 · Outcome attribution
            </span>
          </div>

          <h1 className="font-display font-extrabold tracking-[-0.045em] leading-[0.94] text-lumi-text text-balance text-5xl sm:text-6xl lg:text-7xl xl:text-8xl">
            Verdicts,<br />
            not dashboards.
          </h1>

          <p className="mt-7 text-lg text-dark-soft max-w-[540px] leading-relaxed">
            Marcom AI builds Lumi — the agent that turns your Meta exports into a sharp call. Drop a CSV, get {kill}, {hold}, or {scale} with the cash impact attached, then watch the real CTR and ROAS roll back in. Built for media buyers across MENA.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={onPrimary}
              className="btn-gold inline-flex items-center gap-2 px-7 py-3.5 text-[15px] rounded-xl shadow-gold-glow hover:shadow-card-hover transition-all"
            >
              <Zap className="w-4 h-4" strokeWidth={2} />
              Launch the live demo
              <ArrowRight className="w-4 h-4" strokeWidth={2} />
            </button>
            <a
              href="#how"
              className="btn-ghost inline-flex items-center gap-2 px-5 py-3 text-sm rounded-xl transition-all"
            >
              See how it works
            </a>
          </div>

          <div className="mt-12 flex flex-wrap items-center gap-7">
            <MicroStat label="Median verdict" value="18s" />
            <DividerV />
            <MicroStat label="Avg verdict ROAS" value="3.8x" />
            <DividerV />
            <MicroStat label="Currencies" value="EGP · SAR · AED · KWD" mono />
          </div>
        </div>

        {/* RIGHT — Hero composition with verdict cards */}
        <HeroComposition />
      </div>
    </section>
  );
}

function DividerV() {
  return <span className="w-px h-8 bg-surface-border-strong" />;
}

function MicroStat({ label, value, mono }) {
  return (
    <div>
      <div className={`${mono ? 'system-mono tabular-nums' : 'metric-display'} font-bold text-dark-base`}>
        {value}
      </div>
      <div className="font-mono text-[10px] text-dark-muted tracking-[0.1em] uppercase mt-1">
        {label}
      </div>
    </div>
  );
}

// ── Hero composition: 3 floating verdict cards ──
function HeroComposition() {
  return (
    <div className="relative h-[540px] hidden lg:block">
      {/* BACK: Small context card */}
      <div
        className="absolute top-0 right-0 w-64 bg-surface-card border border-surface-border rounded-2xl p-4 shadow-card"
        style={{
          transform: 'rotate(4deg)',
          animation: 'float-y 8s ease-in-out infinite',
        }}
      >
        <div className="font-mono text-[9px] tracking-[0.08em] uppercase text-dark-muted mb-3">
          Context snapshot
        </div>
        {[
          { tag: 'CPM', txt: '$14.80 avg', bad: false },
          { tag: 'CTR', txt: '1.2% TOFU drop', bad: true },
          { tag: 'GEO', txt: 'Cairo dominant', bad: false },
        ].map((r) => (
          <div key={r.tag} className="flex items-center gap-2 py-1 border-t border-dashed border-surface-border">
            <span className="font-mono text-[9px] font-semibold tracking-[0.08em] px-1.5 py-0.5 rounded bg-lumi-accent/10 text-lumi-accent min-w-[38px] text-center">
              {r.tag}
            </span>
            <span className={`text-[11px] ${r.bad ? 'text-verdict-kill-text' : 'text-dark-soft'}`}>
              {r.txt}
            </span>
          </div>
        ))}
      </div>

      {/* MIDDLE: Big verdict KILL card */}
      <div
        className="absolute top-24 left-0 w-96 bg-surface-card border border-signal-kill/20 rounded-2xl p-6 shadow-panel"
        style={{
          transform: 'rotate(-1.5deg)',
          animation: 'float-y 6s ease-in-out infinite 0.6s',
          boxShadow: '0 28px 56px rgba(0,0,0,0.10), 0 0 40px rgba(239,68,68,0.08)',
        }}
      >
        <div className="flex justify-between items-center mb-3.5">
          <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-lumi-accent font-semibold">
            Verdict locked · 92%
          </span>
          <StagePill stage="DYING" />
        </div>
        <div className="flex items-baseline gap-3.5 mb-2.5">
          <Skull className="w-9 h-9 text-verdict-kill-text" strokeWidth={1.5} />
          <span className="font-display text-7xl font-extrabold tracking-[-0.05em] leading-none text-verdict-kill-text">
            KILL
          </span>
        </div>
        <div className="font-display text-base font-semibold text-dark-base mb-4 leading-snug">
          Stop the bleed.<br />Reallocate to PMax warm.
        </div>
        <div className="p-3.5 bg-verdict-kill-bg rounded-lg">
          <div className="font-mono text-[10px] text-dark-muted tracking-[0.08em] uppercase">
            Financial impact
          </div>
          <div className="metric-display text-dark-base mt-0.5">
            $1,180 / wk
          </div>
          <div className="font-mono text-[11px] text-verdict-kill-text font-semibold mt-0.5">
            saved by killing now
          </div>
        </div>
      </div>

      {/* FRONT: Radar tick card */}
      <div
        className="absolute bottom-8 right-10 w-58 bg-surface-card border border-surface-border rounded-xl p-4.5 shadow-card"
        style={{ transform: 'rotate(2deg)' }}
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="w-1.5 h-1.5 rounded-full bg-signal-scale shadow-scale-glow animate-pulse" />
          <span className="font-mono text-[10px] tracking-[0.08em] uppercase text-signal-scale font-semibold">
            Watching · 14 ad sets
          </span>
        </div>
        <div className="flex gap-1 items-end h-9">
          {[12, 18, 10, 22, 28, 16, 30, 24, 18, 32, 26, 36, 20].map((h, i) => (
            <div
              key={i}
              className={`flex-1 rounded-sm ${i === 12 ? 'bg-lumi-accent' : 'bg-surface-border-strong'}`}
              style={{ height: `${h}px` }}
            />
          ))}
        </div>
        <div className="flex justify-between mt-2.5 text-[10px] text-dark-muted font-mono">
          <span>Mon</span>
          <span>Sun</span>
        </div>
      </div>
    </div>
  );
}

function StagePill({ stage }) {
  const colors = {
    DYING: 'bg-stage-dying/10 text-stage-dying border-stage-dying/30',
    FATIGUED: 'bg-stage-fatigued/10 text-stage-fatigued border-stage-fatigued/30',
    TESTING: 'bg-stage-testing/10 text-stage-testing border-stage-testing/30',
    STABLE: 'bg-stage-stable/10 text-stage-stable border-stage-stable/30',
    SCALING: 'bg-stage-scaling/10 text-stage-scaling border-stage-scaling/30',
  };
  return (
    <span className={`font-mono text-[9px] tracking-[0.08em] uppercase font-semibold px-2 py-1 rounded border ${colors[stage]}`}>
      {stage}
    </span>
  );
}

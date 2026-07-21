import { Link } from 'react-router-dom';
import { ArrowRight, Zap } from 'lucide-react';

export function Hero() {
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

      <div className="max-w-7xl mx-auto grid lg:grid-cols-[1.05fr_0.95fr] gap-16 lg:gap-20 items-center relative">
        {/* LEFT */}
        <div>
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-lumi-accent/10 border border-lumi-accent/28 mb-7">
            <span className="w-1.5 h-1.5 rounded-full bg-lumi-accent shadow-gold-glow animate-pulse" />
            <span className="font-mono text-[11px] tracking-[0.1em] uppercase text-lumi-accent font-semibold">
              Built for MENA performance marketers
            </span>
          </div>

          <h1 className="font-display font-extrabold tracking-[-0.045em] leading-[0.94] text-lumi-text text-balance text-5xl sm:text-6xl lg:text-7xl xl:text-8xl">
            Know what to<br />
            do next.<br />
            Every sync.
          </h1>

          <p className="mt-7 text-lg text-dark-soft max-w-[540px] leading-relaxed">
            Connect your ad accounts. Lumi scores every campaign and tells you
            exactly what to scale, kill, refresh, or watch. No dashboards. No
            guessing.
          </p>

          {/* Trust strip — below subheadline, before the CTAs */}
          <p className="mt-6 text-sm text-dark-muted leading-relaxed max-w-[520px]">
            No dashboards.
            <span className="text-surface-border-strong px-1.5">·</span>
            No fluff.
            <span className="text-surface-border-strong px-1.5">·</span>
            Just decisions backed by your campaign data.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link
              to="/signup"
              className="btn-gold inline-flex items-center gap-2 px-7 py-3.5 text-[15px] rounded-xl shadow-gold-glow hover:shadow-card-hover transition-all"
            >
              <Zap className="w-4 h-4" strokeWidth={2} />
              Get my first verdict
              <ArrowRight className="w-4 h-4" strokeWidth={2} />
            </Link>
            <a
              href="#why"
              className="btn-ghost inline-flex items-center gap-2 px-5 py-3 text-sm rounded-xl transition-all"
            >
              See how Lumi decides
            </a>
          </div>
        </div>

        {/* RIGHT — a live verdict (what the product actually delivers) */}
        <VerdictDemo />
      </div>
    </section>
  );
}

// ── Hero composition: a single campaign verdict ──
// An illustrative preview of a real Lumi verdict (Campaigns → drill-down). The
// signals + recommendation mirror the live verdict card; numbers are an example.
const WHY_SIGNALS = [
  { label: 'CTR', value: '0.48%' },
  { label: 'Frequency', value: '7.1' },
  { label: 'CPA change', value: '+31%' },
];

function VerdictDemo() {
  return (
    <div className="relative flex justify-center lg:h-[520px] lg:items-center">
      <div
        className="w-full max-w-[400px] bg-lumi-bg border border-lumi-border rounded-2xl overflow-hidden"
        style={{
          animation: 'float-y 8s ease-in-out infinite',
          boxShadow: '0 28px 56px rgba(0,0,0,0.14), 0 0 40px rgba(246,201,69,0.08)',
        }}
      >
        <div className="p-5">
          {/* Header */}
          <div className="flex justify-between items-center mb-3">
            <span className="font-display text-sm font-semibold text-lumi-text">Alexandria Leads</span>
            <span className="text-xs text-lumi-muted">
              Account Health <strong className="text-lumi-text font-semibold">44/100</strong>
            </span>
          </div>

          <div className="h-px bg-lumi-border" />

          {/* Verdict */}
          <div className="my-5 text-center">
            <span className="inline-flex items-center px-4 py-1.5 rounded-lg bg-signal-kill/15 border border-signal-kill/30 font-mono text-sm font-bold tracking-[0.14em] text-signal-kill">
              KILL
            </span>
            <p className="font-mono text-[10px] tracking-[0.08em] text-lumi-muted mt-2">CONFIDENCE 94%</p>
          </div>

          {/* Why */}
          <p className="font-mono text-[10px] font-semibold text-lumi-muted uppercase tracking-[0.08em] mb-2">
            Why?
          </p>
          <div className="space-y-1.5 mb-5">
            {WHY_SIGNALS.map(({ label, value }) => (
              <div key={label} className="flex justify-between text-xs">
                <span className="text-lumi-muted">{label}</span>
                <span className="text-signal-kill font-semibold tabular-nums">{value}</span>
              </div>
            ))}
          </div>

          <div className="h-px bg-lumi-border" />

          {/* Recommended action */}
          <div className="mt-4">
            <p className="font-mono text-[10px] font-semibold text-lumi-muted uppercase tracking-[0.08em] mb-1.5">
              Recommended action
            </p>
            <p className="text-sm text-lumi-text font-medium">Pause today.</p>
            <p className="text-sm text-lumi-muted">Reallocate 20% budget to North Coast Leads.</p>
          </div>

          {/* Next sync */}
          <div className="mt-4 pt-3 border-t border-lumi-border flex justify-between items-center">
            <span className="font-mono text-[10px] text-lumi-muted uppercase tracking-[0.08em]">Next sync</span>
            <span className="font-mono text-[10px] text-lumi-accent">14 minutes</span>
          </div>
        </div>
      </div>
    </div>
  );
}

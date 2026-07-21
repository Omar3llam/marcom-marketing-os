import { Link } from 'react-router-dom';
import { Zap } from 'lucide-react';

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
            Lumi turns campaign signals into clear verdicts. Know exactly what to
            scale, pause, refresh, or watch after every campaign sync.
          </p>

          {/* Trust strip — below subheadline, before the CTAs */}
          <p className="mt-6 text-sm text-dark-muted leading-relaxed max-w-[520px]">
            No dashboards.
            <span className="text-surface-border-strong px-1.5">·</span>
            No fluff.
            <span className="text-surface-border-strong px-1.5">·</span>
            Just decisions backed by your data.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link
              to="/signup"
              className="btn-gold inline-flex items-center gap-2 px-7 py-3.5 text-[15px] rounded-xl shadow-gold-glow hover:shadow-card-hover transition-all"
            >
              <Zap className="w-4 h-4" strokeWidth={2} />
              Connect Meta → Get my first verdict
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
// An illustrative preview of a real Lumi verdict (Campaigns → drill-down), framed
// as a product window. The signals + recommendation mirror the live verdict card;
// the numbers are an example.
const WHY_SIGNALS = [
  { label: 'CTR',       value: '0.48%', sub: '42% below average' },
  { label: 'Frequency', value: '7.1',   sub: 'Audience exhausted' },
  { label: 'CPA',       value: '+31%',  sub: 'Rising with no return' },
];

function VerdictDemo() {
  return (
    <div className="relative flex justify-center lg:h-[560px] lg:items-center">
      <div
        className="w-full max-w-[380px] rounded-2xl bg-lumi-bg border border-lumi-border overflow-hidden"
        style={{
          animation: 'float-y 8s ease-in-out infinite',
          boxShadow: '0 28px 56px rgba(0,0,0,0.14), 0 0 40px rgba(246,201,69,0.08)',
        }}
      >
        {/* Window chrome */}
        <div className="flex items-center gap-1.5 px-3.5 py-2.5 bg-lumi-surface border-b border-lumi-border">
          <span className="w-2.5 h-2.5 rounded-full bg-signal-kill/60" />
          <span className="w-2.5 h-2.5 rounded-full bg-lumi-accent/60" />
          <span className="w-2.5 h-2.5 rounded-full bg-signal-scale/60" />
          <span className="ml-2 font-mono text-[10px] text-lumi-muted">Lumi — Campaign Analysis</span>
        </div>

        <div className="p-5">
          {/* Campaign */}
          <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-lumi-muted mb-1">Campaign</p>
          <p className="font-display text-sm font-semibold text-lumi-text mb-4">Alexandria Villas — July</p>

          <div className="h-px bg-lumi-border" />

          {/* Verdict */}
          <div className="my-4 flex items-center justify-between">
            <span className="font-mono text-lg font-bold tracking-[0.12em] text-signal-kill">KILL</span>
            <span className="font-mono text-[10px] text-lumi-muted">
              Confidence <strong className="text-lumi-text font-semibold">94%</strong>
            </span>
          </div>

          <div className="h-px bg-lumi-border" />

          {/* Why */}
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-lumi-muted mt-4 mb-2.5">Why</p>
          <div className="space-y-2.5 mb-4">
            {WHY_SIGNALS.map(({ label, value, sub }) => (
              <div key={label} className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-lumi-text">{label}</p>
                  <p className="text-[10px] text-lumi-muted">{sub}</p>
                </div>
                <span className="text-sm font-semibold tabular-nums text-signal-kill">{value}</span>
              </div>
            ))}
          </div>

          <div className="h-px bg-lumi-border" />

          {/* Recommendation */}
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-lumi-muted mt-4 mb-1.5">Recommendation</p>
          <p className="text-sm text-lumi-text font-medium">Pause today.</p>
          <p className="text-sm text-lumi-muted">Launch fresh creative.</p>
          <p className="text-sm text-lumi-muted">Retest in 7 days.</p>

          {/* Next sync */}
          <div className="mt-4 pt-3 border-t border-lumi-border flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-lumi-muted">Next sync</span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-signal-scale animate-pulse" />
              <span className="font-mono text-[10px] text-lumi-accent">14 minutes</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

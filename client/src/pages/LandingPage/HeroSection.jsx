import { Link } from 'react-router-dom';
import { Sparkles, Send, ArrowRight, Zap } from 'lucide-react';

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

      <div className="max-w-7xl mx-auto grid lg:grid-cols-[1.05fr_0.95fr] gap-20 items-center relative">
        {/* LEFT */}
        <div>
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-lumi-accent/10 border border-lumi-accent/28 mb-7">
            <span className="w-1.5 h-1.5 rounded-full bg-lumi-accent shadow-gold-glow animate-pulse" />
            <span className="font-mono text-[11px] tracking-[0.1em] uppercase text-lumi-accent font-semibold">
              Early Access · Now open
            </span>
          </div>

          <h1 className="font-display font-extrabold tracking-[-0.045em] leading-[0.94] text-lumi-text text-balance text-5xl sm:text-6xl lg:text-7xl xl:text-8xl">
            Just ask.<br />
            Lumi knows<br />
            your campaigns.
          </h1>

          <p className="mt-7 text-lg text-dark-soft max-w-[540px] leading-relaxed">
            Connect your Meta or Google account and ask Lumi anything — why a
            campaign is bleeding, which one to pause first, where your budget is
            going. Real answers from your live data, not generic advice. Built for
            media buyers across MENA.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              to="/signup"
              className="btn-gold inline-flex items-center gap-2 px-7 py-3.5 text-[15px] rounded-xl shadow-gold-glow hover:shadow-card-hover transition-all"
            >
              <Zap className="w-4 h-4" strokeWidth={2} />
              Ask Lumi free
              <ArrowRight className="w-4 h-4" strokeWidth={2} />
            </Link>
            <a
              href="#how"
              className="btn-ghost inline-flex items-center gap-2 px-5 py-3 text-sm rounded-xl transition-all"
            >
              See how it works
            </a>
          </div>

          <div className="mt-12 flex flex-wrap items-center gap-7">
            <MicroStat label="Grounded in" value="Your live data" />
            <DividerV />
            <MicroStat label="Verdicts" value="KILL / HOLD / SCALE" />
            <DividerV />
            <MicroStat label="Currencies" value="EGP · SAR · AED · KWD" mono />
          </div>
        </div>

        {/* RIGHT — Copilot conversation preview */}
        <ChatDemo />
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

// ── Hero composition: a Lumi Copilot conversation ──
// An illustrative preview of the real account-aware Copilot (Overview → Ask Lumi).
// The suggested questions mirror the live panel's prompts; numbers are an example.
const DEMO_QUESTION = 'Why did my CPA jump on the Ramadan campaign?';
const DEMO_SUGGESTIONS = [
  'Which campaign should I pause first?',
  'Where is my budget being wasted?',
  "What's causing audience fatigue?",
];

function ChatDemo() {
  return (
    <div className="relative h-[540px] hidden lg:block">
      {/* Main chat card */}
      <div
        className="absolute inset-x-0 top-6 mx-auto w-[420px] bg-surface-card border border-surface-border rounded-2xl shadow-panel overflow-hidden"
        style={{
          animation: 'float-y 8s ease-in-out infinite',
          boxShadow: '0 28px 56px rgba(0,0,0,0.10), 0 0 40px rgba(246,201,69,0.06)',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-surface-border">
          <Sparkles className="w-4 h-4 text-lumi-accent" strokeWidth={1.5} />
          <span className="font-display text-sm font-semibold text-dark-base">Ask Lumi</span>
          <span className="text-xs text-dark-muted">about this account</span>
          <span className="ml-auto flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-signal-scale shadow-scale-glow animate-pulse" />
            <span className="font-mono text-[10px] tracking-[0.08em] uppercase text-signal-scale font-semibold">
              Live
            </span>
          </span>
        </div>

        {/* Conversation */}
        <div className="p-5 space-y-4">
          {/* User question */}
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-xl rounded-br-sm bg-lumi-accent px-3.5 py-2.5 text-sm text-lumi-bg font-medium">
              {DEMO_QUESTION}
            </div>
          </div>

          {/* Lumi answer */}
          <div className="flex justify-start">
            <div className="max-w-[90%] rounded-xl rounded-bl-sm bg-surface-light border border-surface-border px-3.5 py-3">
              <span className="inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.08em] uppercase text-lumi-accent font-semibold mb-2">
                <Sparkles className="w-3 h-3" strokeWidth={2} />
                Lumi
              </span>
              <p className="text-sm text-dark-soft leading-relaxed">
                Ramadan Wave · Cold ME is bleeding{' '}
                <strong className="text-verdict-kill-text font-semibold">EGP 14,160/week</strong>.
                Frequency hit 4.2 — the audience has seen this ad too many times.
                Verdict: <strong className="text-verdict-kill-text font-bold">KILL</strong>.
                Recover the budget and move it to PMax Retargeting Warm
                (<span className="text-verdict-scale-text font-semibold">ROAS 4.8×</span>).
              </p>
            </div>
          </div>
        </div>

        {/* Suggested questions */}
        <div className="px-5 pb-5 space-y-2">
          {DEMO_SUGGESTIONS.map((q) => (
            <div
              key={q}
              className="w-full rounded-lg bg-lumi-elevated border border-surface-border px-3 py-2 text-left text-xs text-dark-soft"
            >
              {q}
            </div>
          ))}
        </div>

        {/* Input affordance */}
        <div className="px-5 pb-5">
          <div className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface-light px-3 py-2">
            <span className="flex-1 text-xs text-dark-muted">Ask about your campaigns…</span>
            <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-lumi-accent">
              <Send className="w-3.5 h-3.5 text-lumi-bg" strokeWidth={2} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

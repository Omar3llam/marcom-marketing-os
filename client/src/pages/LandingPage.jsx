// ============================================================
// MARCOM / Lumi — LandingPage  (public /)
// ------------------------------------------------------------
// Six sections: Navbar · Hero · Mock OS Window · Capabilities ·
// How It Works · Bottom CTA. CSS-only grid background, no
// image assets, no external chart libs. Below-fold sections
// fade in via IntersectionObserver.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Sparkles, Zap, Globe, Gauge, ScanSearch, ArrowRight, Menu, X,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';

// ── Hook: lazy-reveal a section once it scrolls into view ───
function useReveal() {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!ref.current || shown) return;
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setShown(true); }),
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [shown]);
  return [ref, shown];
}

export default function LandingPage() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-lumi-bg text-lumi-text">
      <Navbar onCta={() => navigate('/signup')} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
      <Hero      onPrimary={() => navigate('/signup')} />
      <MockOSWindow />
      <CapabilitiesGrid />
      <HowItWorks />
      <BottomCTA onCta={() => navigate('/signup')} />
      <Footer />
    </div>
  );
}

// ── Navbar ─────────────────────────────────────────────────
function Navbar({ onCta, menuOpen, setMenuOpen }) {
  return (
    <header className="sticky top-0 z-50 bg-lumi-bg/80 backdrop-blur-md border-b border-lumi-border/50">
      <nav className="max-w-7xl mx-auto flex items-center justify-between px-4 sm:px-6 h-14">
        <Link to="/" className="flex items-center gap-2" aria-label="Lumi home">
          <Sparkles className="w-5 h-5 text-lumi-accent" strokeWidth={1.5} />
          <span className="font-display font-bold tracking-tight text-lumi-accent">LUMI</span>
        </Link>

        <ul className="hidden md:flex items-center gap-8">
          {['Features', 'How It Works', 'Pricing'].map((label) => (
            <li key={label}>
              <a
                href={`#${label.toLowerCase().replace(/\s+/g, '-')}`}
                className="text-sm font-body text-lumi-muted hover:text-lumi-text transition-colors"
              >{label}</a>
            </li>
          ))}
        </ul>

        <div className="hidden md:flex items-center gap-2">
          <Link
            to="/login"
            className="text-sm font-display font-medium text-lumi-muted hover:text-lumi-text px-3 py-1.5 rounded-lg"
          >Log in</Link>
          <button
            type="button"
            onClick={onCta}
            className="bg-lumi-accent text-lumi-bg font-display font-semibold hover:bg-lumi-accent-hover shadow-accent-glow px-4 py-2 rounded-xl text-sm inline-flex items-center gap-1.5 transition-all"
          >
            Get Started <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
        </div>

        <button
          type="button"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((o) => !o)}
          className="md:hidden p-2 text-lumi-muted hover:text-lumi-text"
        >
          {menuOpen ? <X className="w-5 h-5" strokeWidth={1.5} /> : <Menu className="w-5 h-5" strokeWidth={1.5} />}
        </button>
      </nav>

      {/* Mobile overlay */}
      {menuOpen && (
        <div className="md:hidden border-t border-lumi-border bg-lumi-surface animate-fade-in">
          <div className="flex flex-col gap-1 p-4">
            {['Features', 'How It Works', 'Pricing'].map((label) => (
              <a
                key={label}
                href={`#${label.toLowerCase().replace(/\s+/g, '-')}`}
                onClick={() => setMenuOpen(false)}
                className="px-3 py-2 text-sm font-display text-lumi-muted hover:text-lumi-text rounded-lg"
              >{label}</a>
            ))}
            <Link
              to="/login"
              onClick={() => setMenuOpen(false)}
              className="px-3 py-2 text-sm font-display text-lumi-muted hover:text-lumi-text rounded-lg"
            >Log in</Link>
            <button
              type="button"
              onClick={() => { setMenuOpen(false); onCta(); }}
              className="mt-1 w-full bg-lumi-accent text-lumi-bg font-display font-semibold px-4 py-2 rounded-xl text-sm"
            >Get Started →</button>
          </div>
        </div>
      )}
    </header>
  );
}

// ── Hero ───────────────────────────────────────────────────
function Hero({ onPrimary }) {
  return (
    <section className="relative grid-bg min-h-[calc(100vh-3.5rem)] flex flex-col justify-center">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
        <div className="inline-flex items-center gap-2 bg-lumi-accent-soft border border-lumi-accent/30 text-lumi-accent text-xs font-display font-semibold uppercase tracking-widest px-3 py-1.5 rounded-full">
          <Zap className="w-3 h-3" strokeWidth={1.5} />
          NOW LIVE — LUMI AGENT V2
        </div>

        <h1 className="mt-6 font-display font-bold tracking-tight text-lumi-text text-5xl sm:text-6xl lg:text-7xl leading-[1.05]">
          <span className="block">Meet Lumi.</span>
          <span className="block">Your Agentic Marketing</span>
          <span className="block text-lumi-accent">
            Decision Engine.<span className="inline-block w-[3px] h-[0.85em] bg-lumi-accent ml-2 align-middle animate-pulse-slow" aria-hidden="true" />
          </span>
        </h1>

        <p className="mt-6 max-w-xl text-lumi-muted font-body text-base sm:text-lg leading-relaxed">
          Drop a URL. Lock your context in 30 seconds. Get SCALE / HOLD / KILL verdicts on every campaign.
          No consultants. No dashboards. Just decisions.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onPrimary}
            className="bg-lumi-accent text-lumi-bg font-display font-semibold hover:bg-lumi-accent-hover shadow-accent-glow px-5 py-3 rounded-xl text-sm inline-flex items-center gap-2 transition-all"
          >
            Start for free <ArrowRight className="w-4 h-4" strokeWidth={2} />
          </button>
          <a
            href="#how-it-works"
            className="font-display font-medium text-lumi-muted hover:text-lumi-text border border-lumi-border hover:border-lumi-border-strong px-5 py-3 rounded-xl text-sm transition-colors"
          >See how it works ↓</a>
        </div>
      </div>
    </section>
  );
}

// ── Mock OS Window + stats ─────────────────────────────────
function MockOSWindow() {
  const [ref, shown] = useReveal();
  return (
    <section ref={ref} className="px-4 sm:px-6 py-20">
      <div className={cn('max-w-4xl mx-auto', shown && 'animate-slide-up')}>
        <div className="bg-lumi-surface border border-lumi-border rounded-2xl shadow-modal overflow-hidden">
          <div className="bg-lumi-elevated border-b border-lumi-border px-4 py-3 flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-signal-kill" aria-hidden="true" />
            <span className="w-3 h-3 rounded-full bg-signal-hold" aria-hidden="true" />
            <span className="w-3 h-3 rounded-full bg-signal-scale" aria-hidden="true" />
            <span className="ml-3 font-display text-sm text-lumi-muted">Lumi OS — Context Lock</span>
          </div>

          <div className="p-6 space-y-3">
            <div className="font-mono text-sm text-lumi-muted">
              <span className="text-lumi-subtle mr-2">›</span>
              marcomaiagency.com
            </div>

            <div className="bg-lumi-bg border-l-2 border-lumi-accent p-4 rounded-r-xl font-mono text-sm text-lumi-text leading-relaxed whitespace-pre">
{`CONTEXT LOCK INITIATED
──────────────────────
Company:     MARCOM AI
Industry:    B2B Marketing Agency
Market:      MENA (EG, SA, UAE)
Target:      CMOs, Marketing Directors
Competitors: Identified (3)
Tone:        Professional-Aggressive`}
              <div className="mt-3 inline-flex items-center gap-1.5 bg-signal-scale-bg text-signal-scale border border-signal-scale/25 px-2.5 py-1 rounded-full text-xs font-display font-semibold uppercase tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full bg-signal-scale" /> Locked in 28s
              </div>
            </div>
          </div>
        </div>

        {/* Stats bar */}
        <div className="mt-6 bg-lumi-elevated border border-lumi-border rounded-xl px-2 py-3 sm:px-6 grid grid-cols-2 sm:grid-cols-4 divide-x divide-lumi-border">
          {[
            ['5',   'AI Modes'],
            ['18',  'Marketing Tools'],
            ['30s', 'Context Build'],
            ['GCC', 'Calibrated'],
          ].map(([value, label]) => (
            <div key={label} className="flex flex-col items-center justify-center py-2 px-2 sm:px-4">
              <div className="font-mono font-bold text-lg text-lumi-accent">{value}</div>
              <div className="text-xs text-lumi-muted mt-0.5 text-center">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Capabilities Grid ──────────────────────────────────────
function CapabilitiesGrid() {
  const [ref, shown] = useReveal();
  const cards = [
    {
      icon: Globe, iconClass: 'text-lumi-accent bg-lumi-accent-soft',
      title: 'Context Intelligence',
      body:  'Drop any URL. Lumi scrapes, synthesizes, and locks your complete marketing context in under 30 seconds.',
      mode:  'MODE 1 — CONTEXT', modeClass: 'text-lumi-accent bg-lumi-accent-soft',
    },
    {
      icon: Gauge, iconClass: 'text-signal-kill bg-signal-kill-bg',
      title: 'Campaign Verdict Engine',
      body:  'Every campaign gets a SCALE, HOLD, or KILL verdict. Backed by KPI breakdown, financial impact, and wasted-spend analysis.',
      mode:  'MODE 3 — ANALYSIS', modeClass: 'text-signal-kill bg-signal-kill-bg',
    },
    {
      icon: ScanSearch, iconClass: 'text-stage-scaling bg-stage-scaling/10',
      title: 'Content Interrogation',
      body:  '10-step MARCOM framework scores every piece of content. Structured JSON output with predictions and rewrites.',
      mode:  'MODE 4 — CONTENT', modeClass: 'text-stage-scaling bg-stage-scaling/10',
    },
  ];

  return (
    <section id="features" ref={ref} className="px-4 sm:px-6 py-20">
      <div className="max-w-7xl mx-auto">
        <header className="text-center mb-12">
          <h2 className="font-display font-bold text-3xl sm:text-4xl text-lumi-text">
            One agent. Every marketing decision.
          </h2>
          <p className="mt-3 text-lumi-muted text-base max-w-lg mx-auto">
            Lumi operates across five strict modes.
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {cards.map((c, i) => {
            const Icon = c.icon;
            return (
              <article
                key={c.title}
                style={shown ? { animationDelay: `${i * 75}ms` } : undefined}
                className={cn(
                  'flex flex-col bg-lumi-surface border border-lumi-border rounded-2xl p-6',
                  'hover:border-lumi-border-strong hover:shadow-card-hover transition-all duration-200',
                  shown && 'animate-slide-up',
                )}
              >
                <div className={cn('w-12 h-12 rounded-xl p-2 flex items-center justify-center', c.iconClass)}>
                  <Icon className="w-7 h-7" strokeWidth={1.5} />
                </div>
                <h3 className="mt-4 font-display font-semibold text-lg text-lumi-text">{c.title}</h3>
                <p className="mt-2 font-body text-sm text-lumi-muted leading-relaxed">{c.body}</p>
                <span className={cn(
                  'mt-6 self-start text-xs font-mono px-2 py-1 rounded-lg',
                  c.modeClass,
                )}>→ {c.mode}</span>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── How It Works ───────────────────────────────────────────
function HowItWorks() {
  const [ref, shown] = useReveal();
  const steps = [
    { n: '01', title: 'Drop your URL or upload your CSV',
      body: 'Whether it\'s your website or last month\'s Meta export, Lumi pulls it apart.' },
    { n: '02', title: 'Lumi locks your business context',
      body: 'Industry, market, audience, tone — all encoded. Every later answer respects it.' },
    { n: '03', title: 'Get AI verdicts on every campaign',
      body: 'SCALE / HOLD / KILL with financial impact. No dashboards to read — decisions to act on.' },
  ];

  return (
    <section id="how-it-works" ref={ref} className="px-4 sm:px-6 py-20">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        {/* Left — mock sidebar visual */}
        <div className="bg-lumi-surface border border-lumi-border rounded-2xl shadow-modal overflow-hidden order-2 lg:order-1">
          <div className="bg-lumi-elevated border-b border-lumi-border px-4 py-3 flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-signal-kill" aria-hidden="true" />
            <span className="w-3 h-3 rounded-full bg-signal-hold" aria-hidden="true" />
            <span className="w-3 h-3 rounded-full bg-signal-scale" aria-hidden="true" />
            <span className="ml-3 font-display text-sm text-lumi-muted">Lumi OS</span>
          </div>
          <div className="p-4 space-y-2">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-lumi-elevated border border-lumi-border-strong">
              <span className="w-2 h-2 rounded-full bg-signal-scale" />
              <span className="font-display text-sm text-lumi-text">MARCOM-AI</span>
            </div>
            {[
              { label: 'Command Hub',       active: false },
              { label: 'Campaign Analysis', active: true  },
              { label: 'Growth Strategy',   active: false },
              { label: 'Score Content',     active: false },
            ].map((it, i) => (
              <div
                key={it.label}
                style={shown ? { animationDelay: `${i * 80}ms` } : undefined}
                className={cn(
                  'px-3 py-2.5 rounded-xl text-sm font-display flex items-center gap-2',
                  it.active
                    ? 'bg-lumi-elevated border border-lumi-border text-lumi-text shadow-card'
                    : 'text-lumi-muted',
                  shown && 'animate-fade-in',
                )}
              >{it.label}</div>
            ))}
          </div>
        </div>

        {/* Right — steps */}
        <ol className="relative order-1 lg:order-2 space-y-8">
          <span aria-hidden="true" className="hidden sm:block absolute left-[28px] top-12 bottom-8 w-px border-l-2 border-dashed border-lumi-border" />
          {steps.map((s) => (
            <li key={s.n} className="relative flex gap-5">
              <div className="font-mono text-5xl font-bold text-lumi-accent/20 leading-none w-14 shrink-0">{s.n}</div>
              <div>
                <h3 className="font-display font-semibold text-lumi-text text-lg">{s.title}</h3>
                <p className="mt-1 text-lumi-muted text-sm leading-relaxed">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ── Bottom CTA ─────────────────────────────────────────────
function BottomCTA({ onCta }) {
  return (
    <section id="pricing" className="px-4 sm:px-6 py-20">
      <div className="max-w-4xl mx-auto bg-lumi-elevated border border-lumi-border-strong rounded-3xl p-8 sm:p-12 shadow-modal text-center">
        <div className="section-label">The Decision Engine</div>
        <h2 className="mt-2 font-display font-bold text-3xl sm:text-4xl text-lumi-text">
          Your marketing team just got an AI co-pilot.
        </h2>
        <p className="mt-4 max-w-lg mx-auto text-lumi-muted text-sm sm:text-base">
          Lumi replaces expensive consultants with always-on strategic intelligence.
          Start free. No credit card required.
        </p>
        <button
          type="button"
          onClick={onCta}
          className="mt-6 bg-lumi-accent text-lumi-bg font-display font-semibold hover:bg-lumi-accent-hover shadow-accent-glow px-6 py-3 rounded-xl text-sm inline-flex items-center gap-2"
        >
          Start for free <ArrowRight className="w-4 h-4" strokeWidth={2} />
        </button>
        <p className="mt-4 text-xs text-lumi-subtle font-mono">
          Trusted by growth teams across Egypt, Saudi Arabia, and UAE
        </p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="px-4 sm:px-6 py-8 border-t border-lumi-border/50">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-lumi-subtle font-mono">
        <span>© {new Date().getFullYear()} MARCOM AI</span>
        <span>Lumi · Decision OS</span>
      </div>
    </footer>
  );
}

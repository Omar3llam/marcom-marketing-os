// ============================================================
// MARCOM AI — Landing Page
// ============================================================
// Lumi is the agent. Marcom AI is the company.
// Visual reference points: Linear, Vercel, Stripe — generous
// whitespace, restrained palette, editorial typography,
// section rhythm enforced by an 8pt vertical scale.
// ============================================================

const DEMO_URL   = './MARCOM%20Demo.html';         // "Launch the demo" → straight into the app
const SIGNUP_URL = './MARCOM%20Onboarding.html';  // "Start trial / Get started" → onboarding wizard
const APP_URL    = DEMO_URL;                       // alias for sign-in

// ── Tweakable defaults (host can rewrite these on disk) ───────
// Palette: [accent, accentDeep, surfaceLight, surfaceCard, textBase, textSoft]
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "palette": ["#F6C945", "#E0A800", "#F8F6F2", "#FFFFFF", "#2B2B2B", "#3A3A3A"],
  "heroPose": "cards",
  "heroCopy": "decisive"
}/*EDITMODE-END*/;

// Reference palette presets surfaced in the tweaks panel.
const LANDING_PALETTES = [
  ["#F6C945", "#E0A800", "#F8F6F2", "#FFFFFF", "#2B2B2B", "#3A3A3A"],   // Warm Gold (default)
  ["#FFE36F", "#FFC940", "#0B0B0F", "#14141B", "#ECECEC", "#C7C7CD"],   // Midnight desk
  ["#D86E3C", "#B85426", "#F4E9DC", "#FFFAF1", "#2A1810", "#553024"],   // Sunbaked terra
  ["#E63946", "#B0252F", "#FAFAFA", "#FFFFFF", "#1B1B1B", "#3A3A3A"],   // Mono noir + red
];

// Headline copy variants — each reshapes the hero voice.
const HERO_COPY = {
  decisive: {
    eyebrow: 'New · Lumi v4.3 · Outcome attribution',
    title:   ['Verdicts,', 'not dashboards.'],
    body:    (kill, hold, scale) => (
      <>Marcom AI builds Lumi — the agent that turns your Meta exports into a sharp call. Drop a CSV, get {kill}, {hold}, or {scale} with the cash impact attached, then watch the real CTR and ROAS roll back in. Built for media buyers across MENA.</>
    ),
  },
  operator: {
    eyebrow: 'For the desk · not the deck',
    title:   ['Stop reading dashboards.', 'Start running the desk.'],
    body:    (kill, hold, scale) => (
      <>The dashboard tells you the bleed. Lumi tells you what to do — {kill} the dying, {hold} the fragile, {scale} the survivors — with the cash impact attached, before the spend lands.</>
    ),
  },
  bold: {
    eyebrow: 'Built to kill bad ad sets',
    title:   ['The agent that fires', 'your dying ad sets.'],
    body:    (kill, hold, scale) => (
      <>No more "let it run another day." Lumi sweeps every ad set, attaches an evidence trail, and serves a {kill}, {hold}, or {scale} with the dollar figure spelled out. You execute in one tap.</>
    ),
  },
};

// ── Shared rhythm: section padding, container width ──────────
const SX = {
  containerW: 1200,
  sectionPad: '120px 32px',
  sectionPadSm: '88px 32px',
};

// Apply palette tokens onto :root so every var()-based component re-themes.
function useLandingPalette(palette) {
  React.useEffect(() => {
    if (!palette || !Array.isArray(palette)) return;
    const [accent, accentDeep, sLight, sCard, tBase, tSoft] = palette;
    const root = document.documentElement.style;
    root.setProperty('--c-gold',       accent);
    root.setProperty('--c-gold-deep',  accentDeep);
    root.setProperty('--c-gold-glow',  accent);
    root.setProperty('--c-surface-light',    sLight);
    root.setProperty('--c-surface-card',     sCard);
    root.setProperty('--c-text-base',  tBase);
    root.setProperty('--c-text-soft',  tSoft);
    // Derive surface-elevated and borders from accent vs base (lightness flip).
    const isDark = __landingIsDark(sLight);
    root.setProperty('--c-surface-elevated', isDark ? '#1A1A23' : '#F1EEE8');
    root.setProperty('--c-surface-border',   isDark ? '#22222D' : '#EDEAE4');
    root.setProperty('--c-surface-border-strong', isDark ? '#2D2D3A' : '#D4CFCA');
    root.setProperty('--c-text-muted',  isDark ? '#8B8B93' : '#6B6B6B');
    root.setProperty('--c-text-subtle', isDark ? '#5C5C66' : '#9A9A9A');
    // Re-tune the gold-glow shadow with the new accent.
    const rgb = __hexToRgb(accent);
    root.setProperty('--sh-gold-glow', `0 0 24px rgba(${rgb},0.22), 0 0 48px rgba(${rgb},0.12)`);
    document.documentElement.dataset.landingTheme = isDark ? 'dark' : 'light';
  }, [palette]);
}

function __landingIsDark(hex) {
  const c = (hex || '').replace('#', '');
  if (c.length !== 6) return false;
  const r = parseInt(c.slice(0,2),16), g = parseInt(c.slice(2,4),16), b = parseInt(c.slice(4,6),16);
  // Relative luminance approximation.
  return (0.299*r + 0.587*g + 0.114*b) < 128;
}
function __hexToRgb(hex) {
  const c = (hex || '').replace('#', '');
  if (c.length !== 6) return '246,201,69';
  return [parseInt(c.slice(0,2),16), parseInt(c.slice(2,4),16), parseInt(c.slice(4,6),16)].join(',');
}

function Landing() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  useLandingPalette(t.palette);

  return (
    <div style={{ background: 'var(--c-surface-light)', minHeight: '100vh', overflow: 'hidden', color: 'var(--c-text-base)' }}>
      <Nav />
      <Hero pose={t.heroPose} copyKey={t.heroCopy} />
      <TrustedBy />
      <ProblemSection />
      <HowItWorks />
      <VerdictPreview />
      <InsideLumi />
      <NumbersBand />
      <Pricing />
      <FAQ />
      <BigCTA />
      <Footer />
      <LandingTweaks t={t} setTweak={setTweak} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// TWEAKS PANEL
// ══════════════════════════════════════════════════════════════
function LandingTweaks({ t, setTweak }) {
  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Vibe">
        <TweakColor
          label="Palette"
          value={t.palette}
          options={LANDING_PALETTES}
          onChange={(v) => setTweak('palette', v)}
        />
      </TweakSection>
      <TweakSection label="Hero composition">
        <TweakRadio
          label="Pose"
          value={t.heroPose}
          options={[
            { value: 'cards',  label: 'Cards' },
            { value: 'type',   label: 'Type'  },
            { value: 'radar',  label: 'Radar' },
          ]}
          onChange={(v) => setTweak('heroPose', v)}
        />
        <TweakRadio
          label="Copy"
          value={t.heroCopy}
          options={[
            { value: 'decisive', label: 'Decisive' },
            { value: 'operator', label: 'Operator' },
            { value: 'bold',     label: 'Bold'     },
          ]}
          onChange={(v) => setTweak('heroCopy', v)}
        />
      </TweakSection>
    </TweaksPanel>
  );
}

// ── Reveal-on-view hook ──────────────────────────────────────
function useReveal(threshold = 0.18) {
  const ref = React.useRef(null);
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    if (!ref.current || shown) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }),
      { threshold, rootMargin: '0px 0px -8% 0px' }
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [shown, threshold]);
  return { ref, className: shown ? 'reveal-init reveal-on' : 'reveal-init', style: shown ? { transitionDelay: '0ms' } : undefined };
}

// ── BRAND MARK (typographic, no mascot) ─────────────────────
function BrandMark({ size = 'md' }) {
  const fs = size === 'lg' ? 22 : size === 'sm' ? 13 : 16;
  return (
    <a href="#top" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
      {/* Geometric monogram — concentric ring + dot */}
      <span style={{ position: 'relative', width: fs + 6, height: fs + 6, flexShrink: 0 }}>
        <span
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: `1.5px solid var(--c-gold-deep)`,
          }}
        />
        <span
          style={{
            position: 'absolute',
            top: '50%', left: '50%',
            width: fs * 0.35, height: fs * 0.35,
            transform: 'translate(-50%, -50%)',
            background: 'var(--c-gold)',
            borderRadius: '50%',
            boxShadow: '0 0 6px var(--c-gold)',
          }}
        />
      </span>
      <span
        className="font-display"
        style={{
          fontWeight: 700,
          fontSize: fs,
          letterSpacing: '-0.02em',
          color: 'var(--c-text-base)',
        }}
      >
        Marcom<span style={{ color: 'var(--c-gold-deep)' }}>AI</span>
      </span>
    </a>
  );
}

// ── NAV ──────────────────────────────────────────────────────
function Nav() {
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <nav
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 30,
        background: scrolled ? 'rgba(248,246,242,0.82)' : 'transparent',
        backdropFilter: scrolled ? 'blur(14px)' : 'none',
        borderBottom: scrolled ? '1px solid var(--c-surface-border)' : '1px solid transparent',
        transition: 'all 240ms cubic-bezier(0.16,1,0.3,1)',
      }}
    >
      <div
        style={{
          maxWidth: SX.containerW,
          margin: '0 auto',
          padding: scrolled ? '12px 32px' : '20px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 32,
          transition: 'padding 240ms cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        <BrandMark size={scrolled ? 'sm' : 'md'} />
        <div className="desktop-only" style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          <NavLink href="#how">How it works</NavLink>
          <NavLink href="#inside">Inside Lumi</NavLink>
          <NavLink href="#pricing">Pricing</NavLink>
          <NavLink href={APP_URL} sub>Sign in</NavLink>
          <a href={DEMO_URL} className="btn-gold" style={{ padding: scrolled ? '8px 16px' : '10px 18px', fontSize: 13, textDecoration: 'none', transition: 'padding 240ms cubic-bezier(0.16,1,0.3,1)' }}>
            Launch the demo
            <Icons.ArrowRight style={{ fontSize: 13 }} />
          </a>
        </div>
        <a href={DEMO_URL} className="btn-gold mobile-only" style={{ padding: '8px 14px', fontSize: 12, textDecoration: 'none' }}>
          Demo
          <Icons.ArrowRight style={{ fontSize: 12 }} />
        </a>
      </div>
    </nav>
  );
}

function NavLink({ href, children, sub = false }) {
  return (
    <a
      href={href}
      style={{
        fontFamily: 'var(--f-display)',
        fontSize: 13,
        fontWeight: 500,
        color: sub ? 'var(--c-text-muted)' : 'var(--c-text-soft)',
        textDecoration: 'none',
        transition: 'color 150ms',
      }}
      className="hover-color-base"
    >
      {children}
    </a>
  );
}

// ══════════════════════════════════════════════════════════════
// HERO
// ══════════════════════════════════════════════════════════════
function Hero({ pose = 'cards', copyKey = 'decisive' }) {
  const c = HERO_COPY[copyKey] || HERO_COPY.decisive;
  const kill  = <strong style={{ color: 'var(--c-kill-text)'  }}>KILL</strong>;
  const hold  = <strong style={{ color: 'var(--c-hold-text)'  }}>HOLD</strong>;
  const scale = <strong style={{ color: 'var(--c-scale-text)' }}>SCALE</strong>;
  return (
    <section id="top" style={{ position: 'relative', padding: '80px 32px 100px' }}>
      {/* Faint dot grid background */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'radial-gradient(rgba(43,43,43,0.05) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          maskImage: 'radial-gradient(ellipse at 50% 30%, black, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 50% 30%, black, transparent 75%)',
          pointerEvents: 'none',
        }}
      />
      {/* Gold blob */}
      <div
        style={{
          position: 'absolute',
          top: -140, right: '8%',
          width: 560, height: 560,
          background: 'radial-gradient(circle, rgba(246,201,69,0.18), transparent 65%)',
          filter: 'blur(20px)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ maxWidth: SX.containerW, margin: '0 auto', display: 'grid', gridTemplateColumns: '1.05fr 0.95fr', gap: 80, alignItems: 'center', position: 'relative' }}>
        {/* LEFT */}
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 999, background: 'rgba(246,201,69,0.10)', border: '1px solid rgba(246,201,69,0.28)', marginBottom: 28 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--c-gold)', boxShadow: '0 0 6px var(--c-gold)', animation: 'intel-pulse 1.8s ease-in-out infinite' }} />
            <span className="font-mono" style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-gold-deep)', fontWeight: 600 }}>
              {c.eyebrow}
            </span>
          </div>

          <h1
            className="font-display"
            style={{
              fontSize: 84,
              fontWeight: 800,
              letterSpacing: '-0.045em',
              lineHeight: 0.94,
              margin: 0,
              color: 'var(--c-text-base)',
              textWrap: 'balance',
            }}
          >
            {c.title[0]}<br />
            {c.title[1]}
          </h1>

          <p style={{ marginTop: 28, fontSize: 19, lineHeight: 1.5, color: 'var(--c-text-soft)', maxWidth: 540, textWrap: 'pretty' }}>
            {c.body(kill, hold, scale)}
          </p>

          <div style={{ marginTop: 40, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <a href={DEMO_URL} className="btn-gold" style={{ padding: '15px 28px', fontSize: 15, textDecoration: 'none' }}>
              <Icons.Zap style={{ fontSize: 16 }} />
              Launch the live demo
              <Icons.ArrowRight style={{ fontSize: 16 }} />
            </a>
            <a href="#how" className="btn-ghost" style={{ padding: '13px 20px', fontSize: 14, textDecoration: 'none' }}>
              See how it works
            </a>
          </div>

          <div style={{ marginTop: 48, display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
            <MicroStat label="Median verdict" value="18s" />
            <DividerV />
            <MicroStat label="Avg verdict ROAS" value="3.8x" />
            <DividerV />
            <MicroStat label="Currencies" value="EGP · SAR · AED · KWD" mono />
          </div>
        </div>

        {/* RIGHT — composition swappable via Tweaks → Pose */}
        {pose === 'type'  && <HeroTypography />}
        {pose === 'radar' && <HeroRadar />}
        {pose !== 'type' && pose !== 'radar' && <HeroComposition />}
      </div>
    </section>
  );
}

function DividerV() {
  return <span style={{ width: 1, height: 32, background: 'var(--c-surface-border-strong)' }} />;
}

function MicroStat({ label, value, mono }) {
  return (
    <div>
      <div className={mono ? 'font-mono tabular-nums' : 'font-display tabular-nums'} style={{ fontWeight: 700, fontSize: mono ? 14 : 26, letterSpacing: mono ? '0.04em' : '-0.02em', color: 'var(--c-text-base)' }}>{value}</div>
      <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 4 }}>{label}</div>
    </div>
  );
}

// ── Hero composition variants — swap via Tweaks → Hero pose ──
function HeroTypography() {
  const rows = [
    { l: 'KILL',  c: 'var(--c-kill-text)',  ico: Icons.Skull,    delay: 0   },
    { l: 'HOLD',  c: 'var(--c-hold-text)',  ico: Icons.Pause2,   delay: 120 },
    { l: 'SCALE', c: 'var(--c-scale-text)', ico: Icons.Rocket,   delay: 240 },
  ];
  return (
    <div className="hero-decor-only" style={{ position: 'relative', height: 540, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 22, paddingLeft: 24 }}>
      {/* Crosshair grid */}
      <div
        style={{
          position: 'absolute', inset: 0,
          backgroundImage:
            'linear-gradient(rgba(43,43,43,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(43,43,43,0.06) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage: 'radial-gradient(circle at 50% 50%, black, transparent 78%)',
          WebkitMaskImage: 'radial-gradient(circle at 50% 50%, black, transparent 78%)',
          pointerEvents: 'none',
        }}
      />
      {rows.map((r) => (
        <div
          key={r.l}
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            opacity: 0,
            animation: `vector-pop 600ms cubic-bezier(0.16,1,0.3,1) ${r.delay}ms both`,
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: r.c, boxShadow: `0 0 14px ${r.c}` }} />
          <r.ico style={{ fontSize: 38, color: r.c }} />
          <span
            className="font-display"
            style={{
              fontSize: 96,
              fontWeight: 800,
              letterSpacing: '-0.05em',
              lineHeight: 0.85,
              color: r.c,
              textShadow: `0 0 30px ${r.c}30`,
            }}
          >
            {r.l}
          </span>
        </div>
      ))}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, opacity: 0.7 }}>
        <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>
          Three verdicts · one tap to execute
        </span>
      </div>
    </div>
  );
}

function HeroRadar() {
  // Animated radar composition — sweep + targets + signal ticks.
  const targets = [
    { x: 28, y: 32, label: 'cpa↑',  hot: true  },
    { x: 70, y: 28, label: 'freq',  hot: true  },
    { x: 58, y: 64, label: 'ctr↓',  hot: false },
    { x: 22, y: 72, label: 'geo',   hot: false },
    { x: 82, y: 58, label: 'roas',  hot: false },
  ];
  return (
    <div className="hero-decor-only" style={{ position: 'relative', height: 540 }}>
      {/* Radar disc */}
      <div
        style={{
          position: 'absolute',
          top: '50%', left: '50%',
          width: 440, height: 440,
          transform: 'translate(-50%, -50%)',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(246,201,69,0.06), transparent 70%)',
          border: '1px solid rgba(246,201,69,0.18)',
        }}
      />
      {[0.32, 0.55, 0.78, 1].map((s, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: '50%', left: '50%',
            width: 440 * s, height: 440 * s,
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            border: '1px dashed rgba(246,201,69,0.22)',
          }}
        />
      ))}
      {/* Sweep */}
      <div
        style={{
          position: 'absolute',
          top: '50%', left: '50%',
          width: 440, height: 440,
          marginLeft: -220, marginTop: -220,
          borderRadius: '50%',
          background: 'conic-gradient(from 0deg, transparent 0deg, transparent 290deg, rgba(246,201,69,0.55) 358deg, transparent 360deg)',
          animation: 'radar-sweep 3.6s cubic-bezier(0.4,0,0.6,1) infinite',
          maskImage: 'radial-gradient(circle, transparent 8%, black 9%, black 100%)',
          WebkitMaskImage: 'radial-gradient(circle, transparent 8%, black 9%, black 100%)',
        }}
      />
      {/* Crosshair lines */}
      <div style={{ position: 'absolute', top: '50%', left: 'calc(50% - 220px)', width: 440, height: 1, background: 'rgba(246,201,69,0.18)' }} />
      <div style={{ position: 'absolute', left: '50%', top: 'calc(50% - 220px)', height: 440, width: 1, background: 'rgba(246,201,69,0.18)' }} />
      {/* Center */}
      <div
        style={{
          position: 'absolute',
          top: '50%', left: '50%',
          width: 12, height: 12,
          marginLeft: -6, marginTop: -6,
          borderRadius: '50%',
          background: 'var(--c-gold)',
          boxShadow: '0 0 18px var(--c-gold)',
        }}
      />
      {/* Targets */}
      {targets.map((tg, i) => (
        <div
          key={tg.label}
          style={{
            position: 'absolute',
            top: `calc(50% - 220px + ${tg.y * 4.4}px)`,
            left: `calc(50% - 220px + ${tg.x * 4.4}px)`,
            display: 'flex', alignItems: 'center', gap: 6,
            animation: `vector-pop 480ms ease-out ${i * 140}ms both`,
          }}
        >
          <span
            style={{
              width: 8, height: 8, borderRadius: '50%',
              background: tg.hot ? 'var(--c-kill-text)' : 'var(--c-gold)',
              boxShadow: `0 0 ${tg.hot ? 14 : 8}px ${tg.hot ? 'var(--c-kill-text)' : 'var(--c-gold)'}`,
              animation: 'intel-pulse 1.8s ease-in-out infinite',
            }}
          />
          <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: tg.hot ? 'var(--c-kill-text)' : 'var(--c-text-muted)', fontWeight: 600 }}>
            {tg.label}
          </span>
        </div>
      ))}
      {/* Bottom signal ticker */}
      <div
        style={{
          position: 'absolute',
          bottom: 20, left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: 14,
          padding: '10px 16px',
          background: 'var(--c-surface-card)',
          border: '1px solid var(--c-surface-border)',
          borderRadius: 999,
          boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--c-scale)', boxShadow: '0 0 8px var(--c-scale)', animation: 'intel-pulse 1.8s ease-in-out infinite' }} />
        <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>
          Sweeping · 14 ad sets · 2 hot
        </span>
      </div>
    </div>
  );
}

// Hero illustration — three layered UI shards, no mascot
function HeroComposition() {
  return (
    <div className="hero-decor-only" style={{ position: 'relative', height: 540 }}>
      {/* BACK: Memory ledger card */}
      <div
        style={{
          position: 'absolute',
          top: 6, right: 8,
          width: 280,
          background: 'var(--c-surface-card)',
          border: '1px solid var(--c-surface-border)',
          borderRadius: 16,
          padding: 18,
          boxShadow: '0 12px 32px rgba(0,0,0,0.07)',
          transform: 'rotate(3deg)',
          animation: 'float-y 7s ease-in-out infinite',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Icons.Database style={{ fontSize: 14, color: 'var(--c-gold-deep)' }} />
          <span className="section-label" style={{ color: 'var(--c-text-muted)' }}>Memory · 3 matches</span>
        </div>
        {[
          { tag: 'CPA',  txt: '+73% above target',  bad: true },
          { tag: 'FREQ', txt: '4.2 — past 3.5 cap',  bad: true },
          { tag: 'CTR',  txt: '−36% in 48h',         bad: true },
          { tag: 'GEO',  txt: 'Cairo dominant',      bad: false },
        ].map((r) => (
          <div key={r.tag} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px dashed var(--c-surface-border)' }}>
            <span className="font-mono" style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', padding: '2px 6px', borderRadius: 3, background: 'rgba(246,201,69,0.10)', color: 'var(--c-gold-deep)', minWidth: 38, textAlign: 'center' }}>
              {r.tag}
            </span>
            <span style={{ fontSize: 11, color: r.bad ? 'var(--c-kill-text)' : 'var(--c-text-soft)' }}>{r.txt}</span>
          </div>
        ))}
      </div>

      {/* MIDDLE: Big verdict card */}
      <div
        style={{
          position: 'absolute',
          top: 90, left: 0,
          width: 380,
          background: 'var(--c-surface-card)',
          border: '1px solid rgba(239,68,68,0.22)',
          borderRadius: 20,
          padding: 26,
          boxShadow: '0 28px 56px rgba(0,0,0,0.10), 0 0 40px rgba(239,68,68,0.08)',
          transform: 'rotate(-1.5deg)',
          animation: 'float-y 6s ease-in-out infinite',
          animationDelay: '0.6s',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-gold-deep)', fontWeight: 600 }}>
            Verdict locked · 92%
          </span>
          <StagePill stage="DYING" />
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 10 }}>
          <Icons.Skull style={{ fontSize: 38, color: 'var(--c-kill-text)' }} />
          <span className="font-display" style={{ fontSize: 84, fontWeight: 800, letterSpacing: '-0.05em', lineHeight: 0.82, color: 'var(--c-kill-text)' }}>KILL</span>
        </div>
        <div className="font-display" style={{ fontSize: 16, fontWeight: 600, color: 'var(--c-text-base)', marginBottom: 16, lineHeight: 1.35 }}>
          Stop the bleed.<br />Reallocate to PMax warm.
        </div>
        <div style={{ padding: '12px 14px', background: 'var(--c-kill-bg)', borderRadius: 10 }}>
          <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Financial impact</div>
          <div className="font-mono tabular-nums" style={{ fontSize: 26, fontWeight: 700, color: 'var(--c-text-base)', marginTop: 2 }}>$1,180 / wk</div>
          <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-kill-text)', fontWeight: 600, marginTop: 2 }}>saved by killing now</div>
        </div>
      </div>

      {/* FRONT: Radar tick */}
      <div
        style={{
          position: 'absolute',
          bottom: 30, right: 40,
          width: 230,
          background: 'var(--c-surface-card)',
          border: '1px solid var(--c-surface-border)',
          borderRadius: 16,
          padding: 18,
          boxShadow: '0 16px 36px rgba(0,0,0,0.08)',
          transform: 'rotate(2deg)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--c-scale)', boxShadow: '0 0 6px var(--c-scale)', animation: 'intel-pulse 1.8s ease-in-out infinite' }} />
          <span className="section-label" style={{ color: 'var(--c-scale-text)' }}>Watching · 14 ad sets</span>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 36 }}>
          {[12, 18, 10, 22, 28, 16, 30, 24, 18, 32, 26, 36, 20].map((h, i) => (
            <div key={i} style={{ flex: 1, height: `${h}px`, borderRadius: 2, background: i === 12 ? 'var(--c-gold)' : 'var(--c-surface-border-strong)' }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 10, color: 'var(--c-text-muted)' }} className="font-mono">
          <span>Mon</span><span>Sun</span>
        </div>
      </div>
    </div>
  );
}

// ── Trusted by ───────────────────────────────────────────────
function TrustedBy() {
  const partners = [
    { name: 'Maison Salam',    tag: 'Apparel · Cairo' },
    { name: 'Layla & Co.',     tag: 'Beauty · Riyadh' },
    { name: 'Forge Studio',    tag: 'SaaS · Dubai' },
    { name: 'Karim Foods',     tag: 'FMCG · Cairo' },
    { name: 'Atlas Mobility',  tag: 'Logistics · Amman' },
  ];
  const r = useReveal(0.4);
  return (
    <section style={{ padding: '32px 32px 8px' }}>
      <div ref={r.ref} className={r.className} style={{ maxWidth: SX.containerW, margin: '0 auto' }}>
        <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-text-muted)', textAlign: 'center', marginBottom: 24 }}>
          Operators using Lumi every day
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${partners.length}, 1fr)`,
            gap: 12,
            alignItems: 'center',
            opacity: 0.85,
          }}
        >
          {partners.map((p) => (
            <div
              key={p.name}
              className="hover-lift"
              style={{
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                borderLeft: '1px solid var(--c-surface-border)',
                transition: 'transform 200ms, color 200ms',
                cursor: 'default',
              }}
            >
              <div className="font-display" style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--c-text-soft)' }}>
                {p.name}
              </div>
              <div className="font-mono" style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-subtle)' }}>
                {p.tag}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════════════════════
// PROBLEM
// ══════════════════════════════════════════════════════════════
function ProblemSection() {
  return (
    <section style={{ padding: SX.sectionPadSm, borderTop: '1px solid var(--c-surface-border)', background: 'var(--c-surface-card)' }}>
      <div style={{ maxWidth: 880, margin: '0 auto', textAlign: 'center' }}>
        <div className="section-label" style={{ color: 'var(--c-kill-text)', marginBottom: 18 }}>
          The unspoken cost of "let it run"
        </div>
        <h2 className="font-display" style={{ fontSize: 48, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, lineHeight: 1.08, color: 'var(--c-text-base)', textWrap: 'balance' }}>
          Media buyers lose <span style={{ color: 'var(--c-kill-text)' }}>thousands every week</span> to ad sets nobody got around to checking.
        </h2>
        <p style={{ marginTop: 22, fontSize: 17, color: 'var(--c-text-muted)', maxWidth: 640, margin: '22px auto 0', lineHeight: 1.55, textWrap: 'pretty' }}>
          Dashboards show you the bleed. They don't tell you what to do about it. Lumi does — and stamps every verdict with the cash impact, the evidence trail, and a one-click execute.
        </p>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════════════════════
// HOW IT WORKS
// ══════════════════════════════════════════════════════════════
function HowItWorks() {
  const steps = [
    {
      n: '01',
      title: 'Drop a CSV',
      body: 'Meta Ads Manager export, or pull live from the Meta API. Lumi auto-detects local dialect — EGP, SAR, AED, KWD — and validates row-by-row.',
      Icon: Icons.Upload,
    },
    {
      n: '02',
      title: 'Lumi scans 14 vectors',
      body: 'CPA trajectory, frequency saturation, CTR decay, creative fatigue, memory cross-reference. Dual-agent reasoning produces a confidence band on every call.',
      Icon: Icons.Radar,
    },
    {
      n: '03',
      title: 'Verdict in 18 seconds',
      body: 'KILL, HOLD, or SCALE — with the financial impact, reasoning bullets, and a one-tap execute against the Meta Graph API.',
      Icon: Icons.Zap,
    },
  ];
  return (
    <section id="how" style={{ padding: SX.sectionPad }}>
      <div style={{ maxWidth: SX.containerW, margin: '0 auto' }}>
        <SectionHeader eyebrow="How it works" title="Three steps. Eighteen seconds." />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
          {steps.map((s, i) => (
            <StepCard key={s.n} step={s} highlight={i === 1} />
          ))}
        </div>
      </div>
    </section>
  );
}

function StepCard({ step, highlight }) {
  const r = useReveal(0.25);
  const [hover, setHover] = React.useState(false);
  return (
    <div
      ref={r.ref}
      className={r.className}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        background: 'var(--c-surface-card)',
        border: `1px solid ${hover ? 'rgba(246,201,69,0.55)' : 'var(--c-surface-border)'}`,
        borderRadius: 20,
        padding: 32,
        boxShadow: hover ? '0 18px 40px rgba(0,0,0,0.10)' : '0 2px 8px rgba(0,0,0,0.04)',
        overflow: 'hidden',
        transition: 'border-color 240ms, box-shadow 240ms, transform 240ms',
        transform: hover ? 'translateY(-4px)' : 'translateY(0)',
      }}
    >
      {highlight && (
        <div
          style={{
            position: 'absolute',
            top: -80, right: -80,
            width: 220, height: 220,
            background: 'radial-gradient(circle, rgba(246,201,69,0.16), transparent 65%)',
            pointerEvents: 'none',
          }}
        />
      )}
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <span className="font-mono" style={{ fontSize: 38, fontWeight: 700, color: hover ? 'rgba(246,201,69,0.45)' : 'var(--c-surface-border-strong)', letterSpacing: '-0.04em', transition: 'color 240ms' }}>{step.n}</span>
        <div
          style={{
            width: 48, height: 48, borderRadius: 12,
            background: hover ? 'var(--c-gold)' : 'rgba(246,201,69,0.10)',
            border: '1px solid rgba(246,201,69,0.25)',
            color: hover ? 'var(--c-text-base)' : 'var(--c-gold-deep)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 240ms, color 240ms',
          }}
        >
          <step.Icon style={{ fontSize: 24 }} />
        </div>
      </div>
      <h3 className="font-display" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0, color: 'var(--c-text-base)' }}>{step.title}</h3>
      <p style={{ marginTop: 12, fontSize: 14, lineHeight: 1.6, color: 'var(--c-text-soft)' }}>{step.body}</p>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// VERDICT PREVIEW (3 verdicts)
// ══════════════════════════════════════════════════════════════
function VerdictPreview() {
  const cards = [
    { v: 'KILL',  title: 'Eid Carousel · Cold ME',  impact: '$1,180 / wk saved',   sub: 'CPA breached, frequency 4.2' },
    { v: 'HOLD',  title: 'Reels TOFU · LAL 2%',     impact: '3-day re-scan',       sub: 'CTR fragile but volume holds' },
    { v: 'SCALE', title: 'PMax Retargeting Warm',   impact: '+$5,100 / mo proj',   sub: 'ROAS 4.8x, stable 6 days' },
  ];
  const colors = {
    KILL:  { fg: 'var(--c-kill-text)',  bg: 'var(--c-kill-bg)',  Icon: Icons.Skull },
    HOLD:  { fg: 'var(--c-hold-text)',  bg: 'var(--c-hold-bg)',  Icon: Icons.Pause2 },
    SCALE: { fg: 'var(--c-scale-text)', bg: 'var(--c-scale-bg)', Icon: Icons.Rocket },
  };
  return (
    <section style={{ padding: '0 32px 120px' }}>
      <div style={{ maxWidth: SX.containerW, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {cards.map((c, i) => (
            <VerdictPreviewCard key={c.v} card={c} cfg={colors[c.v]} delay={i * 80} />
          ))}
        </div>
      </div>
    </section>
  );
}

function VerdictPreviewCard({ card, cfg, delay }) {
  const r = useReveal(0.2);
  const [hover, setHover] = React.useState(false);
  return (
    <a
      href={DEMO_URL}
      ref={r.ref}
      className={r.className}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        textDecoration: 'none',
        background: 'var(--c-surface-card)',
        border: `1px solid ${hover ? `${cfg.fg}40` : 'var(--c-surface-border)'}`,
        borderLeft: `4px solid ${cfg.fg}`,
        borderRadius: 18,
        padding: 28,
        display: 'block',
        boxShadow: hover ? '0 18px 36px rgba(0,0,0,0.08)' : '0 2px 8px rgba(0,0,0,0.04)',
        transform: hover ? 'translateY(-4px)' : 'translateY(0)',
        transition: 'border-color 240ms, box-shadow 240ms, transform 240ms',
        transitionDelay: `${delay}ms`,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 20 }}>
        <cfg.Icon style={{ fontSize: 32, color: cfg.fg }} />
        <span className="font-display" style={{ fontSize: 48, fontWeight: 800, letterSpacing: '-0.04em', color: cfg.fg, lineHeight: 0.85 }}>{card.v}</span>
      </div>
      <div className="font-display" style={{ fontSize: 16, fontWeight: 600, color: 'var(--c-text-base)' }}>{card.title}</div>
      <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 6 }}>{card.sub}</div>
      <div style={{ marginTop: 18, padding: '11px 14px', background: cfg.bg, borderRadius: 10 }}>
        <div className="font-mono tabular-nums" style={{ fontSize: 14, fontWeight: 700, color: cfg.fg }}>{card.impact}</div>
      </div>
      <div
        style={{
          marginTop: 18,
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 12,
          fontFamily: 'var(--f-display)',
          fontWeight: 500,
          color: hover ? cfg.fg : 'var(--c-text-muted)',
          transition: 'color 240ms',
        }}
      >
        See this in the demo
        <Icons.ArrowRight style={{ fontSize: 12, transform: hover ? 'translateX(4px)' : 'translateX(0)', transition: 'transform 240ms' }} />
      </div>
    </a>
  );
}

// ══════════════════════════════════════════════════════════════
// INSIDE LUMI (features)
// ══════════════════════════════════════════════════════════════
function InsideLumi() {
  const features = [
    {
      Icon: Icons.Radar,
      title: 'Outcome attribution',
      body: 'Every verdict you publish is tracked back to the Meta ad. Real CTR, CPC, and ROAS feed into the next call — so routing chases revenue, not just approval rate.',
      badge: 'New in v4.3',
    },
    {
      Icon: Icons.Cpu,
      title: 'Dual-agent reasoning',
      body: 'Claude handles the analysis; GPT pressure-tests the call. Both must agree before a verdict ships above 85% confidence.',
    },
    {
      Icon: Icons.Database,
      title: '90-day memory layer',
      body: 'Verdicts, overrides, and outcomes are logged together. Lumi grounds each new call in your last quarter of decisions — no cold starts.',
    },
    {
      Icon: Icons.Lock,
      title: '4-layer execution guard',
      body: 'Auth → ownership → idempotency lock → Meta Graph. Every action is audit-logged. Override the verdict in one tap, with full rollback.',
    },
    {
      Icon: Icons.Globe,
      title: 'Tuned for MENA',
      body: 'Aware of Ramadan windows, Friday/Saturday cycles, regional fatigue ceilings, and four local currencies — out of the box.',
    },
  ];
  return (
    <section id="inside" style={{ padding: SX.sectionPad, background: 'var(--c-surface-card)', borderTop: '1px solid var(--c-surface-border)', borderBottom: '1px solid var(--c-surface-border)' }}>
      <div style={{ maxWidth: SX.containerW, margin: '0 auto' }}>
        <header style={{ marginBottom: 64, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64, alignItems: 'flex-end' }}>
          <div>
            <div className="section-label" style={{ marginBottom: 14 }}>Inside Lumi</div>
            <h2 className="font-display" style={{ fontSize: 52, fontWeight: 700, letterSpacing: '-0.035em', margin: 0, color: 'var(--c-text-base)', lineHeight: 1.02, textWrap: 'balance' }}>
              Built like a trading desk, not a BI tool.
            </h2>
          </div>
          <p style={{ fontSize: 16, color: 'var(--c-text-soft)', margin: 0, lineHeight: 1.6, textWrap: 'pretty' }}>
            Marketing is capital allocation. Marcom AI treats it that way — audit trails, idempotent execution, memory, and confidence bands on every call.
          </p>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20 }}>
          {features.map((f, i) => (
            <FeatureCard key={f.title} feat={f} delay={i * 70} wide={!!f.badge} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ feat, delay, wide }) {
  const r = useReveal(0.2);
  const [hover, setHover] = React.useState(false);
  return (
    <div
      ref={r.ref}
      className={r.className}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        gridColumn: wide ? '1 / -1' : 'auto',
        background: wide ? 'var(--c-text-base)' : 'var(--c-surface-light)',
        color: wide ? 'var(--c-surface-light)' : 'inherit',
        border: wide
          ? '1px solid rgba(246,201,69,0.35)'
          : `1px solid ${hover ? 'rgba(246,201,69,0.4)' : 'var(--c-surface-border)'}`,
        borderRadius: 18,
        padding: wide ? '36px 36px' : 32,
        display: 'flex',
        gap: 22,
        transform: hover && !wide ? 'translateY(-2px)' : 'translateY(0)',
        boxShadow: wide
          ? '0 18px 40px rgba(0,0,0,0.14), 0 0 40px rgba(246,201,69,0.10)'
          : (hover ? '0 12px 28px rgba(0,0,0,0.06)' : 'none'),
        transition: 'border-color 240ms, transform 240ms, box-shadow 240ms',
        transitionDelay: `${delay}ms`,
        overflow: 'hidden',
      }}
    >
      {wide && (
        <div
          style={{
            position: 'absolute',
            top: -120, right: -100,
            width: 360, height: 360,
            background: 'radial-gradient(circle, rgba(246,201,69,0.22), transparent 65%)',
            pointerEvents: 'none',
          }}
        />
      )}
      <div
        style={{
          position: 'relative',
          width: wide ? 56 : 48, height: wide ? 56 : 48, borderRadius: wide ? 14 : 12,
          background: wide ? 'var(--c-gold)' : (hover ? 'var(--c-gold)' : 'rgba(246,201,69,0.10)'),
          border: wide ? '1px solid rgba(246,201,69,0.5)' : '1px solid rgba(246,201,69,0.25)',
          color: wide ? 'var(--c-text-base)' : (hover ? 'var(--c-text-base)' : 'var(--c-gold-deep)'),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          transition: 'background 240ms, color 240ms',
        }}
      >
        <feat.Icon style={{ fontSize: wide ? 26 : 22 }} />
      </div>
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h3 className="font-display" style={{ fontSize: wide ? 24 : 19, fontWeight: 700, letterSpacing: '-0.02em', margin: 0, color: wide ? 'var(--c-gold)' : 'var(--c-text-base)' }}>{feat.title}</h3>
          {feat.badge && (
            <span className="font-mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 999, background: 'var(--c-gold)', color: 'var(--c-text-base)' }}>
              {feat.badge}
            </span>
          )}
        </div>
        <p style={{ marginTop: 10, fontSize: wide ? 15 : 14, lineHeight: 1.6, color: wide ? 'rgba(248,246,242,0.78)' : 'var(--c-text-soft)', maxWidth: wide ? 720 : 'none', textWrap: 'pretty' }}>{feat.body}</p>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// NUMBERS BAND
// ══════════════════════════════════════════════════════════════
function NumbersBand() {
  const nums = [
    { v: '18s',     l: 'Median verdict time' },
    { v: '3.8x',    l: 'Avg ROAS on SCALE verdicts' },
    { v: '94%',     l: 'Verdicts confirmed by operators' },
    { v: '240+',    l: 'Active MENA workspaces' },
  ];
  return (
    <section id="numbers" style={{ padding: SX.sectionPadSm }}>
      <div style={{ maxWidth: SX.containerW, margin: '0 auto' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 0,
            padding: '40px 0',
            background: 'var(--c-surface-card)',
            border: '1px solid var(--c-surface-border)',
            borderRadius: 24,
            overflow: 'hidden',
          }}
        >
          {nums.map((n, i) => (
            <div
              key={n.l}
              style={{
                padding: '0 32px',
                borderLeft: i === 0 ? 'none' : '1px solid var(--c-surface-border)',
                display: 'flex', flexDirection: 'column', justifyContent: 'center',
              }}
            >
              <div className="font-display tabular-nums" style={{ fontSize: 52, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1, color: 'var(--c-gold-deep)' }}>{n.v}</div>
              <div style={{ marginTop: 12, fontSize: 13, color: 'var(--c-text-muted)' }}>{n.l}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════════════════════
// PRICING
// ══════════════════════════════════════════════════════════════
const PRICING_CURRENCIES = [
  { code: 'USD', sym: '$',    sub: 'United States Dollar', billing: '/month' },
  { code: 'EGP', sym: 'EGP',  sub: 'Egyptian Pound',       billing: '/month' },
  { code: 'SAR', sym: 'SAR',  sub: 'Saudi Riyal',          billing: '/month' },
  { code: 'AED', sym: 'AED',  sub: 'UAE Dirham',           billing: '/month' },
];

const PRICING_PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    tag: 'For solo operators',
    prices:  { USD:  39, EGP:  1800, SAR:  149, AED:  144 },
    yearly:  { USD: 390, EGP: 18000, SAR: 1490, AED: 1440 },
    features: [
      { ok: true,  text: '1 workspace · 1 Meta ad account' },
      { ok: true,  text: '20 verdicts / month' },
      { ok: true,  text: 'Content Lab — 30 generations / mo' },
      { ok: true,  text: 'Social Calendar (read-only)' },
      { ok: true,  text: 'Email alerts' },
      { ok: false, text: 'Multi-channel verdicts' },
      { ok: false, text: 'Memory layer · 90-day history' },
      { ok: false, text: 'White-label / agency seats' },
    ],
    cta: 'Start free for 7 days',
  },
  {
    id: 'pro',
    name: 'Pro',
    tag: 'For media buyers + small teams',
    badge: 'Most popular',
    prices:  { USD: 149, EGP:  6900, SAR:  559, AED:  548 },
    yearly:  { USD: 1490, EGP: 69000, SAR: 5590, AED: 5480 },
    features: [
      { ok: true, text: '3 workspaces · all ad channels' },
      { ok: true, text: 'Unlimited verdicts' },
      { ok: true, text: 'Content Lab — unlimited generations' },
      { ok: true, text: 'Social Calendar — full plan + schedule' },
      { ok: true, text: 'Memory layer · 90-day history' },
      { ok: true, text: 'Slack + WhatsApp alerts' },
      { ok: true, text: 'Priority Lumi tuning' },
      { ok: false, text: 'Agency white-label' },
    ],
    cta: 'Start Pro trial',
    featured: true,
  },
  {
    id: 'agency',
    name: 'Agency',
    tag: 'For agencies + holdcos',
    prices:  { USD: 499, EGP: 22500, SAR: 1869, AED: 1832 },
    yearly:  { USD: 4990, EGP: 225000, SAR: 18690, AED: 18320 },
    features: [
      { ok: true, text: 'Unlimited workspaces' },
      { ok: true, text: 'Unlimited team seats' },
      { ok: true, text: 'White-label + custom domains' },
      { ok: true, text: 'Cross-workspace memory transfer' },
      { ok: true, text: 'Dedicated Slack channel' },
      { ok: true, text: 'Custom Lumi fine-tuning' },
      { ok: true, text: 'SSO · audit log · SOC 2' },
      { ok: true, text: 'Annual contract pricing' },
    ],
    cta: 'Talk to sales',
  },
];

function Pricing() {
  const [cur, setCur] = React.useState('USD');
  const [annual, setAnnual] = React.useState(false);
  const curCfg = PRICING_CURRENCIES.find((c) => c.code === cur);

  return (
    <section id="pricing" style={{ padding: SX.sectionPad, background: 'var(--c-surface-card)', borderTop: '1px solid var(--c-surface-border)', borderBottom: '1px solid var(--c-surface-border)' }}>
      <div style={{ maxWidth: SX.containerW, margin: '0 auto' }}>
        {/* Header */}
        <header style={{ marginBottom: 40, textAlign: 'center' }}>
          <div className="section-label" style={{ marginBottom: 14 }}>Pricing</div>
          <h2 className="font-display" style={{ fontSize: 52, fontWeight: 700, letterSpacing: '-0.035em', margin: 0, color: 'var(--c-text-base)', lineHeight: 1.04, textWrap: 'balance' }}>
            One price. Local currency. No surprises.
          </h2>
          <p style={{ marginTop: 14, fontSize: 17, color: 'var(--c-text-soft)', lineHeight: 1.55, maxWidth: 640, margin: '14px auto 0', textWrap: 'pretty' }}>
            Pay in your reporting currency. Annual saves two months. 7-day trial on Starter and Pro.
          </p>
        </header>

        {/* Currency + billing toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24, marginBottom: 40, flexWrap: 'wrap' }}>
          {/* Currency pills */}
          <div style={{ display: 'inline-flex', padding: 4, background: 'var(--c-surface-elevated)', border: '1px solid var(--c-surface-border)', borderRadius: 999 }}>
            {PRICING_CURRENCIES.map((c) => (
              <button
                key={c.code}
                onClick={() => setCur(c.code)}
                className="font-mono"
                style={{
                  padding: '7px 16px',
                  background: cur === c.code ? 'var(--c-surface-card)' : 'transparent',
                  border: 'none',
                  color: cur === c.code ? 'var(--c-text-base)' : 'var(--c-text-muted)',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  cursor: 'pointer',
                  boxShadow: cur === c.code ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
                  transition: 'all 180ms',
                }}
              >
                {c.code}
              </button>
            ))}
          </div>

          {/* Annual / monthly toggle */}
          <div style={{ display: 'inline-flex', padding: 4, background: 'var(--c-surface-elevated)', border: '1px solid var(--c-surface-border)', borderRadius: 999 }}>
            {[
              { id: false, label: 'Monthly' },
              { id: true,  label: 'Annual',  sub: 'save 17%' },
            ].map((b) => (
              <button
                key={String(b.id)}
                onClick={() => setAnnual(b.id)}
                className="font-display"
                style={{
                  padding: '7px 16px',
                  background: annual === b.id ? 'var(--c-surface-card)' : 'transparent',
                  border: 'none',
                  color: annual === b.id ? 'var(--c-text-base)' : 'var(--c-text-muted)',
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: annual === b.id ? 600 : 500,
                  cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  boxShadow: annual === b.id ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
                  transition: 'all 180ms',
                }}
              >
                {b.label}
                {b.sub && (
                  <span className="font-mono" style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--c-gold)', color: 'var(--c-text-base)', letterSpacing: '0.06em' }}>
                    SAVE 17%
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Plan cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18, alignItems: 'stretch' }}>
          {PRICING_PLANS.map((p) => (
            <PricingCard key={p.id} plan={p} cur={cur} curCfg={curCfg} annual={annual} />
          ))}
        </div>

        {/* Footnotes */}
        <div style={{ marginTop: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24, flexWrap: 'wrap', color: 'var(--c-text-muted)', fontSize: 12 }} className="font-mono">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icons.Check style={{ fontSize: 12, color: 'var(--c-scale-text)' }} />
            7-day trial · no card needed
          </span>
          <span>·</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icons.Lock style={{ fontSize: 12 }} />
            Cancel anytime
          </span>
          <span>·</span>
          <span>VAT not included</span>
        </div>
      </div>
    </section>
  );
}

function PricingCard({ plan, cur, curCfg, annual }) {
  const r = useReveal(0.18);
  const [hover, setHover] = React.useState(false);
  const isFeatured = !!plan.featured;
  const isAgency = plan.id === 'agency';

  const monthly = plan.prices[cur];
  const yearly  = plan.yearly[cur];
  const effective = annual ? Math.round(yearly / 12) : monthly;
  const symBefore = cur === 'USD';

  const fmt = (n) => {
    if (n >= 1000) return n.toLocaleString('en-US');
    return n.toString();
  };

  return (
    <div
      ref={r.ref}
      className={r.className}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        background: isFeatured ? 'var(--c-text-base)' : 'var(--c-surface-light)',
        color: isFeatured ? 'var(--c-surface-light)' : 'var(--c-text-base)',
        border: `1px solid ${isFeatured ? 'rgba(246,201,69,0.4)' : (hover ? 'rgba(246,201,69,0.5)' : 'var(--c-surface-border)')}`,
        borderRadius: 22,
        padding: 32,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: isFeatured ? '0 24px 48px rgba(0,0,0,0.18), 0 0 40px rgba(246,201,69,0.10)' : (hover ? '0 16px 36px rgba(0,0,0,0.08)' : '0 2px 8px rgba(0,0,0,0.04)'),
        transform: hover && !isFeatured ? 'translateY(-4px)' : 'translateY(0)',
        transition: 'border-color 240ms, box-shadow 240ms, transform 240ms',
        overflow: 'hidden',
      }}
    >
      {/* Featured glow */}
      {isFeatured && (
        <div
          style={{
            position: 'absolute',
            top: -100, right: -100,
            width: 320, height: 320,
            background: 'radial-gradient(circle, rgba(246,201,69,0.20), transparent 60%)',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Badge */}
      {plan.badge && (
        <span
          className="font-mono"
          style={{
            position: 'absolute',
            top: 18, right: 18,
            fontSize: 9,
            letterSpacing: '0.12em',
            fontWeight: 700,
            padding: '3px 9px',
            borderRadius: 999,
            background: 'var(--c-gold)',
            color: 'var(--c-text-base)',
            textTransform: 'uppercase',
            boxShadow: '0 0 12px rgba(246,201,69,0.4)',
          }}
        >
          {plan.badge}
        </span>
      )}

      {/* Header */}
      <div style={{ position: 'relative' }}>
        <h3 className="font-display" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0, color: isFeatured ? 'var(--c-gold)' : 'var(--c-text-base)' }}>{plan.name}</h3>
        <p style={{ marginTop: 6, fontSize: 13, color: isFeatured ? 'rgba(248,246,242,0.65)' : 'var(--c-text-muted)' }}>{plan.tag}</p>
      </div>

      {/* Price */}
      <div style={{ position: 'relative', marginTop: 28, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          {symBefore && <span className="font-display" style={{ fontSize: 28, fontWeight: 700, color: isFeatured ? 'rgba(248,246,242,0.85)' : 'var(--c-text-soft)', marginRight: 2 }}>{curCfg.sym}</span>}
          <span
            className="font-display tabular-nums"
            style={{
              fontSize: 58,
              fontWeight: 800,
              letterSpacing: '-0.04em',
              lineHeight: 0.95,
              color: isFeatured ? 'var(--c-surface-light)' : 'var(--c-text-base)',
            }}
          >
            {fmt(effective)}
          </span>
          {!symBefore && (
            <span className="font-display" style={{ fontSize: 16, fontWeight: 600, color: isFeatured ? 'rgba(248,246,242,0.65)' : 'var(--c-text-muted)', marginLeft: 6 }}>
              {curCfg.sym}
            </span>
          )}
          <span className="font-mono" style={{ fontSize: 13, color: isFeatured ? 'rgba(248,246,242,0.6)' : 'var(--c-text-muted)', marginLeft: 6 }}>
            /mo
          </span>
        </div>
        {annual && (
          <div className="font-mono" style={{ marginTop: 6, fontSize: 11, color: isFeatured ? 'rgba(248,246,242,0.55)' : 'var(--c-text-subtle)' }}>
            Billed {curCfg.sym}{symBefore ? '' : ' '}{fmt(yearly)}/year · save {curCfg.sym}{symBefore ? '' : ' '}{fmt(monthly * 12 - yearly)}
          </div>
        )}
        {!annual && (
          <div className="font-mono" style={{ marginTop: 6, fontSize: 11, color: isFeatured ? 'rgba(248,246,242,0.55)' : 'var(--c-text-subtle)' }}>
            Billed monthly · pay-as-you-go
          </div>
        )}
      </div>

      {/* CTA */}
      <a
        href={isAgency ? '#' : SIGNUP_URL}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '13px 18px',
          borderRadius: 12,
          fontFamily: 'var(--f-display)',
          fontWeight: 700,
          fontSize: 14,
          letterSpacing: '-0.01em',
          textDecoration: 'none',
          background: isFeatured ? 'var(--c-gold)' : (isAgency ? 'transparent' : 'var(--c-surface-card)'),
          color: isFeatured ? 'var(--c-text-base)' : (isAgency ? 'var(--c-text-base)' : 'var(--c-text-base)'),
          border: isFeatured ? 'none' : (isAgency ? '1px solid var(--c-text-soft)' : '1px solid var(--c-surface-border-strong)'),
          boxShadow: isFeatured ? 'var(--sh-gold-glow)' : 'none',
          transition: 'all 200ms',
          position: 'relative',
        }}
      >
        {plan.cta}
        <Icons.ArrowRight style={{ fontSize: 13 }} />
      </a>

      {/* Features */}
      <ul style={{ marginTop: 24, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
        {plan.features.map((f, i) => (
          <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, opacity: f.ok ? 1 : 0.4 }}>
            <span
              style={{
                width: 18, height: 18, borderRadius: '50%',
                background: f.ok
                  ? (isFeatured ? 'rgba(246,201,69,0.20)' : 'var(--c-scale-bg)')
                  : 'transparent',
                color: f.ok
                  ? (isFeatured ? 'var(--c-gold)' : 'var(--c-scale-text)')
                  : (isFeatured ? 'rgba(248,246,242,0.4)' : 'var(--c-text-subtle)'),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, marginTop: 2,
                border: !f.ok ? `1px dashed ${isFeatured ? 'rgba(248,246,242,0.3)' : 'var(--c-surface-border-strong)'}` : 'none',
              }}
            >
              {f.ok
                ? <Icons.Check style={{ fontSize: 11, strokeWidth: 3 }} />
                : <Icons.X style={{ fontSize: 9 }} />
              }
            </span>
            <span style={{
              fontSize: 13,
              lineHeight: 1.5,
              color: isFeatured ? (f.ok ? 'rgba(248,246,242,0.92)' : 'rgba(248,246,242,0.5)') : (f.ok ? 'var(--c-text-soft)' : 'var(--c-text-muted)'),
              textDecoration: f.ok ? 'none' : 'line-through',
            }}>
              {f.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// FAQ
// ══════════════════════════════════════════════════════════════
const FAQ_ITEMS = [
  {
    q: 'Do you really pay attention to MENA?',
    a: 'Lumi is built for MENA from day one — EGP / SAR / AED / KWD support, Ramadan + Friday/Saturday cycle awareness, regional fatigue ceilings, and dialect-aware copy generation (Egyptian, Gulf, Levantine, Maghrebi, MSA).',
  },
  {
    q: 'How does outcome attribution actually work?',
    a: 'When you publish an approved creative to Meta, Lumi stamps it with an attribution ID. Every six hours we pull the Meta Insights API for that ad — impressions, clicks, CTR, CPC, spend, conversions, ROAS — and feed it back into provider scoring. Over time, the agent learns which model produces which outcome and routes accordingly. Pro and Agency only.',
  },
  {
    q: 'Can I switch currency on my invoice?',
    a: 'Yes. Pick your reporting currency in onboarding or in Settings. Invoices follow that choice. Mid-cycle changes pro-rate cleanly.',
  },
  {
    q: 'What counts as a "verdict"?',
    a: 'One ad-set-level KILL / HOLD / SCALE decision. Starter is capped at 20 / month. Pro and Agency are unlimited. Re-running a verdict on the same data within 24h doesn\'t count twice.',
  },
  {
    q: 'How does the memory layer work?',
    a: 'Every verdict, override, and outcome is logged. Lumi grounds new decisions in your last 90 days of campaign history. Pro and Agency unlock the full memory layer; Starter sees the last 14 days.',
  },
  {
    q: 'Can I migrate from a manual setup?',
    a: 'Yes. Drop a Meta CSV from the last 30 days and Lumi will bootstrap the memory layer in the background while you start running new verdicts.',
  },
  {
    q: 'Is there an enterprise tier?',
    a: 'Agency covers most agency + holdco needs. For anything bigger — SLAs, dedicated AI tuning, on-prem — talk to sales.',
  },
];

function FAQ() {
  const [open, setOpen] = React.useState(0);
  return (
    <section style={{ padding: SX.sectionPad }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <header style={{ marginBottom: 40, textAlign: 'center' }}>
          <div className="section-label" style={{ marginBottom: 14 }}>FAQ</div>
          <h2 className="font-display" style={{ fontSize: 44, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, color: 'var(--c-text-base)', lineHeight: 1.06 }}>
            Questions you'd expect us to answer.
          </h2>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {FAQ_ITEMS.map((item, i) => (
            <FAQRow key={i} item={item} open={open === i} onToggle={() => setOpen(open === i ? -1 : i)} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQRow({ item, open, onToggle }) {
  return (
    <div
      style={{
        background: 'var(--c-surface-card)',
        border: `1px solid ${open ? 'rgba(246,201,69,0.4)' : 'var(--c-surface-border)'}`,
        borderRadius: 14,
        overflow: 'hidden',
        transition: 'border-color 200ms',
      }}
    >
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 16,
          padding: '18px 22px',
          background: 'transparent',
          border: 'none',
          textAlign: 'left',
          cursor: 'pointer',
          color: 'inherit',
        }}
      >
        <span className="font-display" style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--c-text-base)' }}>
          {item.q}
        </span>
        <span style={{
          width: 28, height: 28, borderRadius: '50%',
          background: open ? 'rgba(246,201,69,0.10)' : 'var(--c-surface-elevated)',
          color: open ? 'var(--c-gold-deep)' : 'var(--c-text-muted)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          transition: 'all 200ms',
          transform: open ? 'rotate(45deg)' : 'rotate(0)',
        }}>
          <Icons.Plus style={{ fontSize: 14 }} />
        </span>
      </button>
      {open && (
        <div className="anim-slide-up" style={{ padding: '0 22px 20px' }}>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--c-text-soft)', lineHeight: 1.65, maxWidth: 680 }}>
            {item.a}
          </p>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// BIG CTA
// ══════════════════════════════════════════════════════════════
function BigCTA() {
  return (
    <section style={{ padding: '60px 32px 120px' }}>
      <div
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          position: 'relative',
          background: 'var(--c-text-base)',
          borderRadius: 32,
          padding: '80px 56px',
          overflow: 'hidden',
          color: 'var(--c-surface-light)',
        }}
      >
        {/* Gold glow */}
        <div
          style={{
            position: 'absolute',
            top: -140, right: -140,
            width: 460, height: 460,
            background: 'radial-gradient(circle, rgba(246,201,69,0.30), transparent 60%)',
            pointerEvents: 'none',
          }}
        />
        {/* Faint grid */}
        <div
          style={{
            position: 'absolute', inset: 0,
            backgroundImage: 'linear-gradient(rgba(246,201,69,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(246,201,69,0.06) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
            maskImage: 'radial-gradient(ellipse at 70% 50%, black, transparent 70%)',
            WebkitMaskImage: 'radial-gradient(ellipse at 70% 50%, black, transparent 70%)',
            pointerEvents: 'none',
          }}
        />

        <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr auto', gap: 56, alignItems: 'center' }}>
          <div>
            <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-gold)', marginBottom: 16 }}>
              Stop watching campaigns bleed.
            </div>
            <h2 className="font-display" style={{ fontSize: 56, fontWeight: 800, letterSpacing: '-0.035em', lineHeight: 1.02, margin: 0, textWrap: 'balance' }}>
              Try the demo.<br />
              It takes <span style={{ color: 'var(--c-gold)' }}>18 seconds.</span>
            </h2>
            <p style={{ marginTop: 22, fontSize: 16, color: 'rgba(248,246,242,0.7)', maxWidth: 520, lineHeight: 1.6, textWrap: 'pretty' }}>
              No signup. Walk through a live campaign, watch Lumi reach a verdict, and execute it against a sandbox Meta API.
            </p>
            <div style={{ marginTop: 32, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <a href={DEMO_URL} className="btn-gold" style={{ padding: '15px 26px', fontSize: 15, textDecoration: 'none' }}>
                <Icons.Zap style={{ fontSize: 16 }} />
                Launch the demo
                <Icons.ArrowRight style={{ fontSize: 16 }} />
              </a>
              <a href={SIGNUP_URL} style={{ fontFamily: 'var(--f-display)', fontSize: 14, color: 'rgba(248,246,242,0.85)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                Personalize your setup
                <Icons.ArrowUpRight style={{ fontSize: 12 }} />
              </a>
            </div>
          </div>

          {/* Right column — typographic verdict trio */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
            {[
              { l: 'KILL',  c: 'var(--c-kill)' },
              { l: 'HOLD',  c: 'var(--c-hold)' },
              { l: 'SCALE', c: 'var(--c-scale)' },
            ].map((row) => (
              <div key={row.l} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: row.c, boxShadow: `0 0 8px ${row.c}` }} />
                <span
                  className="font-display"
                  style={{
                    fontSize: 64,
                    fontWeight: 800,
                    letterSpacing: '-0.04em',
                    lineHeight: 0.9,
                    color: row.c,
                    opacity: 0.95,
                  }}
                >
                  {row.l}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════════════════════
// FOOTER
// ══════════════════════════════════════════════════════════════
function Footer() {
  return (
    <footer style={{ padding: '48px 32px', borderTop: '1px solid var(--c-surface-border)', background: 'var(--c-surface-card)' }}>
      <div style={{ maxWidth: SX.containerW, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <BrandMark size="sm" />
          <span style={{ width: 1, height: 14, background: 'var(--c-surface-border-strong)' }} />
          <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Cairo · Riyadh · Dubai
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 26, fontSize: 12, color: 'var(--c-text-muted)' }} className="font-mono">
          <a href={DEMO_URL} style={{ color: 'inherit', textDecoration: 'none' }}>Demo</a>
          <a href="#" style={{ color: 'inherit', textDecoration: 'none' }}>Pricing</a>
          <a href="#" style={{ color: 'inherit', textDecoration: 'none' }}>Docs</a>
          <a href="#" style={{ color: 'inherit', textDecoration: 'none' }}>Status</a>
          <a href="#" style={{ color: 'inherit', textDecoration: 'none' }}>Privacy</a>
          <span>© 2026 Marcom AI</span>
        </div>
      </div>
    </footer>
  );
}

// ── Shared section header ────────────────────────────────────
function SectionHeader({ eyebrow, title, sub }) {
  return (
    <header style={{ marginBottom: 56, maxWidth: 760 }}>
      <div className="section-label" style={{ marginBottom: 14 }}>{eyebrow}</div>
      <h2 className="font-display" style={{ fontSize: 52, fontWeight: 700, letterSpacing: '-0.035em', margin: 0, color: 'var(--c-text-base)', lineHeight: 1.04, textWrap: 'balance' }}>{title}</h2>
      {sub && <p style={{ marginTop: 16, fontSize: 17, color: 'var(--c-text-soft)', lineHeight: 1.55, textWrap: 'pretty' }}>{sub}</p>}
    </header>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Landing />);

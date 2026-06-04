// ============================================================
// MARCOM Demo — Reusable primitives
// ============================================================
// VerdictPill, StagePill, PriorityPill, InlineBar, Skeleton,
// LumiLoader, SectionLabel, MetricRowSimple, GlowDot
// ============================================================

import { Icons } from './icons.jsx';

const VERDICT_CFG = {
  KILL:  { cls: 'v-kill',  label: 'KILL',  Icon: Icons.Skull },
  HOLD:  { cls: 'v-hold',  label: 'HOLD',  Icon: Icons.Pause2 },
  SCALE: { cls: 'v-scale', label: 'SCALE', Icon: Icons.Rocket },
  TEST:  { cls: 'v-hold',  label: 'TEST',  Icon: Icons.ScanSearch },
};

export function VerdictPill({ verdict, size = 'sm', className = '', showIcon = true }) {
  const cfg = VERDICT_CFG[verdict] || VERDICT_CFG.HOLD;
  const sizeCls = size === 'lg'
    ? { padding: '8px 14px', fontSize: 13, gap: 6 }
    : { padding: '4px 10px', fontSize: 11, gap: 4 };
  return (
    <span
      className={`font-display ${cfg.cls} ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        ...sizeCls,
        borderRadius: 999,
        fontWeight: 700,
        letterSpacing: '0.08em',
      }}
    >
      {showIcon && <cfg.Icon style={{ fontSize: size === 'lg' ? 14 : 12 }} />}
      {cfg.label}
    </span>
  );
}

const PRIORITY_CFG = {
  HIGH:   { color: 'var(--c-kill)',  bg: 'var(--c-kill-bg)' },
  MEDIUM: { color: 'var(--c-hold)',  bg: 'var(--c-hold-bg)' },
  LOW:    { color: 'var(--c-text-muted)', bg: 'var(--c-surface-elevated)' },
};

export function PriorityPill({ priority }) {
  const cfg = PRIORITY_CFG[priority] || PRIORITY_CFG.LOW;
  return (
    <span
      className="font-mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        borderRadius: 4,
        color: cfg.color,
        background: cfg.bg,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.color }} />
      {priority}
    </span>
  );
}

// rgba values mirror the CSS variable resolved colors.
// Using rgba() directly because CSS variables cannot have hex alpha
// suffixes appended to them — `var(--x)40` is invalid CSS.
const STAGE_CFG = {
  DYING:    { color: 'var(--c-stage-dying)',    border: 'rgba(239,68,68,0.25)',   bg: 'rgba(239,68,68,0.10)' },
  FATIGUED: { color: 'var(--c-stage-fatigued)', border: 'rgba(245,158,11,0.25)', bg: 'rgba(245,158,11,0.10)' },
  TESTING:  { color: 'var(--c-stage-testing)',  border: 'rgba(99,102,241,0.25)', bg: 'rgba(99,102,241,0.10)' },
  STABLE:   { color: 'var(--c-stage-stable)',   border: 'rgba(16,185,129,0.25)', bg: 'rgba(16,185,129,0.10)' },
  SCALING:  { color: 'var(--c-stage-scaling)',  border: 'rgba(6,182,212,0.25)',  bg: 'rgba(6,182,212,0.10)' },
};

export function StagePill({ stage }) {
  const cfg = STAGE_CFG[stage] || STAGE_CFG.STABLE;
  return (
    <span
      className="font-mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 8px',
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        borderRadius: 4,
        color: cfg.color,
        border: `1px solid ${cfg.border}`,
        background: cfg.bg,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.color }} />
      {stage}
    </span>
  );
}

// ── Inline progress / data bar ───────────────────────────────
export function InlineBar({ value, max = 100, label, sub, color = 'var(--c-gold)', height = 4, animate = true, delay = 0 }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div style={{ width: '100%' }}>
      {(label || sub) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          {label && <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{label}</span>}
          {sub && <span className="font-mono tabular-nums" style={{ fontSize: 11, color: 'var(--c-text-base)', fontWeight: 600 }}>{sub}</span>}
        </div>
      )}
      <div
        style={{
          width: '100%',
          height,
          borderRadius: 999,
          background: 'var(--c-surface-elevated)',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: color,
            borderRadius: 999,
            transformOrigin: 'left',
            animation: animate ? `confidence-fill 700ms cubic-bezier(0.16,1,0.3,1) ${delay}ms both` : undefined,
          }}
        />
      </div>
    </div>
  );
}

// ── Pulsing dot (live/active indicator) ──────────────────────
// pulse=false adds .no-pulse which suppresses the ::after ring via CSS
// (inline animation: none on the host doesn't reach the ::after pseudo-element)
export function GlowDot({ color = 'var(--c-scale)', size = 8, pulse = true }) {
  return (
    <span
      className={`pulse-dot${!pulse ? ' no-pulse' : ''}`}
      style={{ background: color, width: size, height: size }}
    />
  );
}

// ── Lumi loader (radar sweep) ────────────────────────────────
export function LumiLoader({ label, sub, size = 80 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        {/* Concentric rings */}
        {[0.4, 0.7, 1].map((s, i) => (
          <div key={i} style={{
            position: 'absolute',
            inset: 0,
            transform: `scale(${s})`,
            border: '1px solid var(--c-gold)',
            borderRadius: '50%',
            opacity: 0.3 + i * 0.2,
          }} />
        ))}
        {/* Sweep */}
        <div style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: `conic-gradient(from 0deg, transparent 0deg, transparent 280deg, var(--c-gold) 358deg, transparent 360deg)`,
          animation: 'radar-sweep 2.4s cubic-bezier(0.4,0,0.6,1) infinite',
          maskImage: 'radial-gradient(circle, transparent 30%, black 31%)',
          WebkitMaskImage: 'radial-gradient(circle, transparent 30%, black 31%)',
        }} />
        {/* Center dot */}
        <div style={{
          position: 'absolute',
          top: '50%', left: '50%',
          width: 8, height: 8,
          marginLeft: -4, marginTop: -4,
          borderRadius: '50%',
          background: 'var(--c-gold)',
          boxShadow: '0 0 12px var(--c-gold)',
        }} />
      </div>
      {label && <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>{label}</div>}
      {sub && <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>{sub}</div>}
    </div>
  );
}

// ── Section label (consistent uppercase header) ──────────────
export function SectionLabel({ children, accent, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {accent && <span style={{ width: 4, height: 14, background: 'var(--c-gold)', borderRadius: 2 }} />}
        <span className="section-label">{children}</span>
      </div>
      {right}
    </div>
  );
}

// ── Metric callout (label + tabular value + optional trend icon) ─
// Named MetricRowSimple to avoid collision with campaigns-page.jsx's
// local MetricRow which has a different, richer interface.
export function MetricRowSimple({ label, value, sub, trend }) {
  const trendColor = trend === 'up' ? 'var(--c-scale)' : trend === 'down' ? 'var(--c-kill)' : 'var(--c-text-muted)';
  const TrendIcon = trend === 'up' ? Icons.TrendingUp : trend === 'down' ? Icons.TrendingDown : null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{label}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {TrendIcon && <TrendIcon style={{ fontSize: 12, color: trendColor }} />}
        <span className="font-mono tabular-nums" style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-base)' }}>{value}</span>
        {sub && <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-subtle)' }}>{sub}</span>}
      </span>
    </div>
  );
}

// ── Card wrapper ─────────────────────────────────────────────
export function Card({ children, className = '', style = {}, hover = false, accent = false }) {
  return (
    <div
      className={`card ${hover ? 'card-hover' : ''} ${className}`}
      style={{ overflow: 'hidden', ...style }}
    >
      {accent && <div className="card-accent-bar" />}
      {children}
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────
export function Skeleton({ width = '100%', height = 16, radius = 6 }) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: radius,
        background: 'linear-gradient(90deg, var(--c-surface-elevated) 0%, var(--c-surface-border) 50%, var(--c-surface-elevated) 100%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.5s ease-in-out infinite',
      }}
    />
  );
}

// ── useIsMobile: < 760px = mobile (matches styles.css breakpoint) ─
export function useIsMobile(bp = 760) {
  const [m, setM] = React.useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(`(max-width: ${bp}px)`).matches
      : false
  );
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(`(max-width: ${bp}px)`);
    const onChange = (e) => {
      setM(e.matches);
      try { document.documentElement.dataset.viewport = e.matches ? 'mobile' : 'desktop'; } catch {}
    };
    onChange(mq);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, [bp]);
  return m;
}

// Seed the data-viewport attribute on first parse so CSS like .mobile-only works pre-hydration.
try {
  if (typeof window !== 'undefined' && window.matchMedia) {
    document.documentElement.dataset.viewport =
      window.matchMedia('(max-width: 760px)').matches ? 'mobile' : 'desktop';
  }
} catch {}

// ── Currency formatter ────────────────────────────────────────
export function formatCurrency(amount, currencySym) {
  return `${currencySym} ${amount.toLocaleString('en-US')}`;
}

// ── Error boundary ────────────────────────────────────────────
export class ErrorBoundarySimple extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) return this.props.fallback ?? null;
    return this.props.children;
  }
}

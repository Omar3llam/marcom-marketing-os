// ============================================================
// MARCOM Demo — Theatre View
// ------------------------------------------------------------
// The AI "thinking" stage. ~3.5s of compelling motion for demo
// (production says ~18s). This is the moment of value reveal.
// ============================================================

import { Icons } from './icons.jsx';
import { DEMO_DATA } from './data.js';

const THEATRE_DURATION_MS = 3800;

export function TheatreView({ workspace, featured, onComplete }) {
  const [elapsed, setElapsed] = React.useState(0);
  const timersRef = React.useRef([]);
  const vectors = DEMO_DATA.VECTORS.map(v => ({
    ...v,
    unit: v.unit.replace('{currency}', workspace.currencySym),
  }));

  React.useEffect(() => {
    return () => timersRef.current.forEach(clearTimeout);
  }, []);

  React.useEffect(() => {
    const start = performance.now();
    let raf;
    const tick = () => {
      const e = performance.now() - start;
      setElapsed(e);
      if (e < THEATRE_DURATION_MS) raf = requestAnimationFrame(tick);
      else timersRef.current.push(setTimeout(onComplete, 350));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onComplete]);

  const pct = Math.min(100, (elapsed / THEATRE_DURATION_MS) * 100);
  const activeIdx = Math.min(vectors.length - 1, Math.floor((elapsed / THEATRE_DURATION_MS) * vectors.length));

  return (
    <div
      data-screen-label="Theatre — AI Analysis"
      className="theatre-grid"
      style={{
        minHeight: 'calc(100vh - 56px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 32px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Soft gold glow behind */}
      <div
        style={{
          position: 'absolute',
          top: '50%', left: '50%',
          width: 800, height: 800,
          marginLeft: -400, marginTop: -400,
          background: 'radial-gradient(circle at center, rgba(246,201,69,0.10), transparent 60%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(280px, 380px) minmax(180px, 1fr)', gap: 24, maxWidth: 1280, width: '100%', alignItems: 'center' }}>
        {/* ── LEFT: Scanning vectors ───────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 4 }}>
            Scan vectors · 14
          </div>
          {vectors.slice(0, 7).map((v, i) => (
            <VectorRow key={v.id} v={v} active={activeIdx === i} done={activeIdx > i} />
          ))}
        </div>

        {/* ── CENTER: The radar ────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
          <RadarCanvas pct={pct} />

          <div style={{ textAlign: 'center' }}>
            <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 6 }}>
              Lumi is analyzing
            </div>
            <div className="font-display" style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--c-text-base)', marginBottom: 4 }}>
              {featured.campaign.name}
            </div>
            <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>
              {featured.campaign.adset} · {featured.campaign.daysRun} days · {featured.rows} rows
            </div>
          </div>

          {/* Progress sweep */}
          <div style={{ width: '100%', maxWidth: 320 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 11 }} className="font-mono">
              <span style={{ color: 'var(--c-text-muted)' }}>{activeIdx + 1} / {vectors.length} vectors</span>
              <span style={{ color: 'var(--c-text-base)', fontWeight: 600 }} className="tabular-nums">{Math.floor(pct)}%</span>
            </div>
            <div style={{ height: 3, borderRadius: 2, background: 'var(--c-surface-border)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, var(--c-gold-deep), var(--c-gold), var(--c-gold-glow))' }} />
            </div>
          </div>
        </div>

        {/* ── RIGHT: Memory + market dialect ───────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 4 }}>
            Memory · cross-reference
          </div>

          <MemoryCard
            title="3 prior decisions matched"
            sub="MENA cold launches · last 90 days"
            Icon={Icons.Database}
            delay={500}
          />
          <MemoryCard
            title="Market dialect: EGP"
            sub="14-day fatigue threshold detected"
            Icon={Icons.Globe}
            delay={900}
          />
          <MemoryCard
            title="Counterfactual modeled"
            sub="6 reallocation paths · ranked"
            Icon={Icons.Cpu}
            delay={1500}
          />
          <MemoryCard
            title="Risk envelope · σ confidence"
            sub="High band · 92%"
            Icon={Icons.Brain}
            delay={2200}
            highlight
          />
        </div>
      </div>

      {/* Bottom hint */}
      <div style={{ position: 'absolute', bottom: 32, left: 0, right: 0, textAlign: 'center' }}>
        <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)', letterSpacing: '0.08em' }}>
          Production median: <span style={{ color: 'var(--c-text-muted)' }}>18 seconds</span>  ·  Demo speed: <span style={{ color: 'var(--c-gold)' }}>×5</span>
        </div>
      </div>
    </div>
  );
}

function VectorRow({ v, active, done }) {
  const color = done ? 'var(--c-scale-text)' : active ? 'var(--c-gold-deep)' : 'var(--c-text-subtle)';
  const bg = active ? 'rgba(246,201,69,0.10)' : 'transparent';

  return (
    <div
      style={{
        padding: '8px 12px',
        background: bg,
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        border: active ? '1px solid rgba(246,201,69,0.3)' : '1px solid transparent',
        transition: 'all 240ms',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Status dot */}
      <div style={{ width: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {done ? (
          <Icons.Check style={{ fontSize: 12, color: 'var(--c-scale-text)' }} />
        ) : active ? (
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--c-gold)', boxShadow: '0 0 8px var(--c-gold)', animation: 'intel-pulse 1.4s ease-in-out infinite' }} />
        ) : (
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', border: '1px solid var(--c-text-subtle)' }} />
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="font-mono" style={{ fontSize: 12, color, fontWeight: active ? 600 : 400 }}>{v.label}</div>
        <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-subtle)' }}>{v.unit}</div>
      </div>

      {active && (
        <span
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'linear-gradient(90deg, transparent, rgba(246,201,69,0.15), transparent)',
            animation: 'scan-line 1.8s ease-in-out infinite',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}

// ── Radar canvas ─────────────────────────────────────────────
function RadarCanvas({ pct }) {
  const size = 260;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      {/* Concentric rings */}
      {[1, 0.72, 0.44, 0.18].map((s, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: `${(1 - s) * 50}%`,
            left: `${(1 - s) * 50}%`,
            width: `${s * 100}%`,
            height: `${s * 100}%`,
            border: '1px solid rgba(246,201,69,0.25)',
            borderRadius: '50%',
          }}
        />
      ))}

      {/* Crosshair */}
      <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'rgba(246,201,69,0.15)' }} />
      <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'rgba(246,201,69,0.15)' }} />

      {/* Sweep */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: 'conic-gradient(from 0deg, transparent 0deg, transparent 260deg, rgba(246,201,69,0.0) 280deg, rgba(246,201,69,0.5) 350deg, var(--c-gold) 360deg)',
          animation: 'radar-sweep 2.4s cubic-bezier(0.4,0,0.6,1) infinite',
        }}
      />

      {/* Detected blips */}
      {[
        { x: 72, y: 24, color: 'var(--c-kill)', delay: 0.3 },
        { x: 38, y: 65, color: 'var(--c-hold)', delay: 0.9 },
        { x: 80, y: 78, color: 'var(--c-scale)', delay: 1.6 },
        { x: 16, y: 42, color: 'var(--c-text-subtle)', delay: 2.2 },
      ].map((b, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${b.x}%`,
            top: `${b.y}%`,
            width: 8, height: 8,
            marginLeft: -4, marginTop: -4,
            borderRadius: '50%',
            background: b.color,
            boxShadow: `0 0 10px ${b.color}`,
            animation: 'intel-pulse 1.8s ease-in-out infinite',
            animationDelay: `${b.delay}s`,
            opacity: pct > b.delay * 25 ? 1 : 0,
            transition: 'opacity 400ms',
          }}
        />
      ))}

      {/* Center mascot */}
      <div
        style={{
          position: 'absolute',
          top: '50%', left: '50%',
          width: 72, height: 72,
          marginLeft: -36, marginTop: -36,
          borderRadius: '50%',
          background: 'var(--c-surface-card)',
          border: '1px solid rgba(246,201,69,0.4)',
          boxShadow: 'var(--sh-gold-glow)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <img
          src={(typeof window !== "undefined" && window.__resources && window.__resources.lumiMascot) || "assets/lumi-mascot.png"}
          alt="Lumi"
          style={{
            width: 64,
            height: 64,
            objectFit: 'contain',
            objectPosition: 'top',
            animation: 'float-y 3s ease-in-out infinite',
            filter: 'drop-shadow(0 4px 8px rgba(246,201,69,0.3))',
            marginTop: 8,
          }}
        />
      </div>
    </div>
  );
}

function MemoryCard({ title, sub, Icon, delay = 0, highlight = false }) {
  return (
    <div
      className="anim-slide-up"
      style={{
        animationDelay: `${delay}ms`,
        background: highlight ? 'rgba(246,201,69,0.08)' : 'var(--c-surface-card)',
        border: highlight ? '1px solid rgba(246,201,69,0.4)' : '1px solid var(--c-surface-border)',
        borderRadius: 12,
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: highlight ? 'var(--sh-gold-glow)' : 'var(--sh-card)',
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: highlight ? 'rgba(246,201,69,0.18)' : 'var(--c-surface-elevated)',
        color: highlight ? 'var(--c-gold-deep)' : 'var(--c-text-soft)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon style={{ fontSize: 15 }} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="font-display" style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-base)' }}>{title}</div>
        <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', marginTop: 2 }}>{sub}</div>
      </div>
    </div>
  );
}


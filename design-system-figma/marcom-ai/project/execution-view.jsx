// ============================================================
// MARCOM Demo — Execution View
// ------------------------------------------------------------
// 4-layer guard timeline → Meta API call → success.
// Demo animates each step at ~450ms; ~3s total.
// ============================================================

import { Icons } from './icons.jsx';
import { VerdictPill, formatCurrency } from './primitives.jsx';
import { DEMO_DATA } from './data.js';
import { BrandMark } from './brand-mark.jsx';

export function ExecutionView({ workspace, featured, onComplete, onBackToHub }) {
  const steps = DEMO_DATA.EXECUTION;
  const [done, setDone] = React.useState(-1); // index of last completed step
  const [phase, setPhase] = React.useState('running'); // running | complete
  const intervalRef = React.useRef(null);

  const startProgress = () => {
    let i = 0;
    intervalRef.current = setInterval(() => {
      setDone(i);
      i++;
      if (i >= steps.length) {
        clearInterval(intervalRef.current);
        setTimeout(() => setPhase('complete'), 500);
      }
    }, 480);
  };

  React.useEffect(() => {
    startProgress();
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  if (phase === 'complete') return <DoneView workspace={workspace} featured={featured} onBackToHub={onBackToHub} />;

  const c = featured.campaign;

  return (
    <div data-screen-label="Execution" style={{ maxWidth: 880, margin: '0 auto', padding: '40px 32px' }}>
      <Breadcrumb crumbs={[
        { label: 'Command Hub', onClick: onBackToHub },
        { label: 'Campaign Intelligence' },
        { label: 'Verdict' },
        { label: 'Executing', active: true },
      ]} />

      <header style={{ marginBottom: 32 }}>
        <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-gold-deep)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--c-gold)', boxShadow: '0 0 8px var(--c-gold)', animation: 'intel-pulse 1.4s ease-in-out infinite' }} />
          Executing against Meta Graph API
        </div>
        <h1 className="font-display" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, color: 'var(--c-text-base)' }}>
          {c.action.title}
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, color: 'var(--c-text-soft)' }}>
          {c.action.target} · {formatCurrency(c.action.budgetMoveDailyMinor, workspace.currency)}/day → {c.action.budgetMoveTarget}
        </p>
      </header>

      {/* Timeline */}
      <div
        style={{
          background: 'var(--c-surface-card)',
          border: '1px solid var(--c-surface-border)',
          borderRadius: 16,
          padding: 8,
          boxShadow: 'var(--sh-card)',
        }}
      >
        {steps.map((s, i) => (
          <StepRow
            key={s.id}
            step={s}
            i={i}
            status={i <= done ? (i < done ? 'done' : 'active') : 'pending'}
          />
        ))}
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginTop: 18 }}>
        <Stat label="Latency" value={done >= 0 ? `${130 + done * 60}ms` : '—'} tone="neutral" />
        <Stat label="Idempotency key" value="adset-4218990-pause" tone="neutral" />
        <Stat label="Workspace lock" value="held" tone="positive" />
      </div>
    </div>
  );
}

function StepRow({ step, i, status }) {
  const cfg = {
    done:    { icon: <Icons.Check style={{ fontSize: 14 }} />, bg: 'var(--c-scale-bg)',  fg: 'var(--c-scale-text)', text: 'var(--c-text-soft)' },
    active:  { icon: <Spinner />, bg: 'rgba(246,201,69,0.10)', fg: 'var(--c-gold-deep)', text: 'var(--c-text-base)' },
    pending: { icon: <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>{String(i + 1).padStart(2, '0')}</span>, bg: 'var(--c-surface-elevated)', fg: 'var(--c-text-subtle)', text: 'var(--c-text-subtle)' },
  }[status];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 16px',
        borderRadius: 12,
        background: status === 'active' ? 'rgba(246,201,69,0.04)' : 'transparent',
        transition: 'background 200ms',
      }}
    >
      <div
        style={{
          width: 32, height: 32, borderRadius: '50%',
          background: cfg.bg, color: cfg.fg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          transition: 'all 240ms',
        }}
      >
        {cfg.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="font-display" style={{ fontSize: 13, fontWeight: 500, color: cfg.text }}>{step.label}</div>
        <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-subtle)', marginTop: 2 }}>{step.sub}</div>
      </div>
      {status === 'done' && <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-scale-text)' }}>OK</span>}
    </div>
  );
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" style={{ animation: 'radar-sweep 1.2s linear infinite' }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="rgba(246,201,69,0.2)" strokeWidth="2" />
      <path d="M12 3 A9 9 0 0 1 21 12" fill="none" stroke="var(--c-gold-deep)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Stat({ label, value, tone }) {
  const color = tone === 'positive' ? 'var(--c-scale-text)' : 'var(--c-text-base)';
  return (
    <div style={{ padding: '12px 14px', background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 10 }}>
      <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>{label}</div>
      <div className="font-mono tabular-nums" style={{ fontSize: 13, fontWeight: 600, color, marginTop: 4 }}>{value}</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Done — confirmation + next steps
// ══════════════════════════════════════════════════════════════
export function DoneView({ workspace, featured, onBackToHub }) {
  const c = featured.campaign;
  return (
    <div data-screen-label="Done" style={{ maxWidth: 880, margin: '0 auto', padding: '60px 32px' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div
          className="anim-verdict-enter"
          style={{
            position: 'relative',
            width: 140, height: 140, margin: '0 auto 8px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {/* Soft green halo */}
          <div
            style={{
              position: 'absolute', inset: 0,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(16,185,129,0.20), transparent 65%)',
            }}
          />
          <BrandMark size={108} />
          {/* Small green check badge */}
          <div
            style={{
              position: 'absolute',
              right: 10, bottom: 14,
              width: 32, height: 32, borderRadius: '50%',
              background: 'var(--c-scale)',
              color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(16,185,129,0.4)',
              border: '3px solid var(--c-surface-light)',
            }}
          >
            <Icons.Check style={{ fontSize: 18, strokeWidth: 3 }} />
          </div>
        </div>
        <h1 className="font-display" style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, color: 'var(--c-text-base)' }}>
          Verdict executed.
        </h1>
        <p style={{ marginTop: 10, fontSize: 15, color: 'var(--c-text-soft)', maxWidth: 540, margin: '10px auto 0' }}>
          Ad set paused, budget reallocated, decision logged to memory. Lumi will keep watching the reallocated budget on PMax warm.
        </p>
      </div>

      <div
        className="anim-slide-up"
        style={{
          background: 'var(--c-surface-card)',
          border: '1px solid var(--c-surface-border)',
          borderRadius: 16,
          padding: 24,
          marginBottom: 18,
          boxShadow: 'var(--sh-card)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
          <div>
            <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 4 }}>
              Decision · sess-05
            </div>
            <div className="font-display" style={{ fontSize: 17, fontWeight: 600, color: 'var(--c-text-base)' }}>
              {c.name}
            </div>
            <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 2 }}>
              {c.action.target} · paused {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </div>
          </div>
          <VerdictPill verdict={c.verdict} size="lg" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          <DoneStat label="Saved / wk" value={formatCurrency(c.financialImpact.savedWeeklyMinor, workspace.currency)} positive />
          <DoneStat label="Reallocated" value={`${formatCurrency(c.action.budgetMoveDailyMinor, workspace.currency)}/day`} />
          <DoneStat label="To" value="PMax Warm" />
          <DoneStat label="Confidence" value={`${c.confidence}%`} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button className="btn-ghost" onClick={onBackToHub}>
          <Icons.ChevronLeft style={{ fontSize: 14 }} />
          Back to Command Hub
        </button>
        <button className="btn-gold" onClick={onBackToHub}>
          <Icons.Eye style={{ fontSize: 14 }} />
          Watch the reallocation
          <Icons.ArrowRight style={{ fontSize: 14 }} />
        </button>
      </div>
    </div>
  );
}

function DoneStat({ label, value, positive }) {
  return (
    <div>
      <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</div>
      <div className="font-mono tabular-nums" style={{ fontSize: 15, fontWeight: 700, color: positive ? 'var(--c-scale-text)' : 'var(--c-text-base)', marginTop: 4 }}>{value}</div>
    </div>
  );
}


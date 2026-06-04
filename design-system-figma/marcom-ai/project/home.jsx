// ============================================================
// Lumi — Home page (account pulse)
// ============================================================
// Replaces the old Command Hub. Account overview with 4 stats,
// alerts panel, AI insight, quick actions, recent activity.
// ============================================================

import { Icons } from './icons.jsx';
import { VerdictPill, formatCurrency } from './primitives.jsx';

export function HomePage({ workspace, radarAlerts, sessions, onNav, onReviewAlert, onStartFlow }) {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const highAlerts = radarAlerts.filter((a) => a.priority === 'HIGH');
  const stats = {
    spend:  workspace.spendTier,
    cpa:    workspace.benchmarks?.avgCpa
              ? formatCurrency(workspace.benchmarks.avgCpa, workspace.currencySym)
              : `${workspace.currencySym} —`,
    waste:  formatCurrency(highAlerts.reduce((s, a) => s + (a.bleedRaw ?? 0), 0), workspace.currencySym) + '/wk',
    health: workspace.healthScore ?? 72,
  };

  return (
    <div data-screen-label="Home" style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 32px 24px' }}>
      <header style={{ marginBottom: 24 }}>
        <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icons.Radar style={{ fontSize: 13, color: 'var(--c-gold)' }} />
          Account Pulse · {workspace.name}
        </div>
        <h1 className="font-display" style={{ fontWeight: 700, fontSize: 36, letterSpacing: '-0.03em', margin: 0, color: 'var(--c-text-base)', lineHeight: 1.1 }}>
          {greeting}, {workspace.user?.name ?? 'there'}. Here's your account pulse.
        </h1>
      </header>

      {/* 4 stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        <StatCard label="Total spend" value={stats.spend} Icon={Icons.BarChart} sub="last 30 days" />
        <StatCard label="Blended CPA" value={stats.cpa} Icon={Icons.Target} sub="↓ 8% vs prev" tone="positive" />
        <StatCard label="Wasted spend" value={stats.waste} Icon={Icons.AlertTriangle} sub="2 bleeding ad sets" tone="danger" />
        <StatCard label="Account health" value={`${stats.health}/100`} Icon={Icons.Activity} sub="Fair — needs review" tone="warn" gauge={stats.health} />
      </div>

      {/* 3 column row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
        <AlertsPanel alerts={highAlerts} onReview={onReviewAlert} />
        <AIInsightPanel workspace={workspace} onAct={() => onStartFlow('campaign')} />
        <QuickActionsPanel onStartFlow={onStartFlow} onNav={onNav} />
      </div>

      {/* Recent activity */}
      <ActivityFeed sessions={sessions} />
    </div>
  );
}

// ── Stat card ────────────────────────────────────────────────
function StatCard({ label, value, sub, Icon, tone, gauge }) {
  const toneCfg = {
    positive: { color: 'var(--c-scale-text)', bg: 'var(--c-scale-bg)' },
    danger:   { color: 'var(--c-kill-text)',  bg: 'var(--c-kill-bg)' },
    warn:     { color: 'var(--c-hold-text)',  bg: 'var(--c-hold-bg)' },
  }[tone] || { color: 'var(--c-text-base)', bg: 'rgba(246,201,69,0.10)' };

  return (
    <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, padding: 18, boxShadow: 'var(--sh-card)', position: 'relative', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>{label}</span>
        <div style={{ width: 28, height: 28, borderRadius: 7, background: toneCfg.bg, color: toneCfg.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon style={{ fontSize: 14 }} />
        </div>
      </div>
      <div className="font-display tabular-nums" style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--c-text-base)', lineHeight: 1 }}>{value}</div>
      <div className="font-mono" style={{ fontSize: 11, color: toneCfg.color, marginTop: 6 }}>{sub}</div>
      {gauge != null && (
        <div style={{ marginTop: 10, height: 3, borderRadius: 2, background: 'var(--c-surface-elevated)', overflow: 'hidden' }}>
          <div style={{ width: `${gauge}%`, height: '100%', background: `linear-gradient(90deg, var(--c-kill), var(--c-hold), var(--c-scale))`, borderRadius: 2 }} />
        </div>
      )}
    </div>
  );
}

// ── Alerts panel ─────────────────────────────────────────────
function AlertsPanel({ alerts, onReview }) {
  return (
    <Panel
      title="Alerts"
      Icon={Icons.AlertTriangle}
      iconTone="kill"
      meta={`${alerts.length} high priority`}
    >
      {alerts.length === 0 ? (
        <EmptyPanel text="Nothing burning right now." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {alerts.slice(0, 3).map((a) => (
            <button
              key={a.id}
              onClick={() => onReview(a)}
              className="hover-bg-card"
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px',
                background: 'var(--c-surface-elevated)',
                border: '1px solid var(--c-surface-border)',
                borderLeft: `3px solid var(--c-${a.verdict === 'KILL' ? 'kill' : a.verdict === 'SCALE' ? 'scale' : 'hold'})`,
                borderRadius: 8, textAlign: 'left', cursor: 'pointer',
                transition: 'background 120ms',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="font-display" style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text-base)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.campaign}</div>
                <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', marginTop: 2 }}>{a.signal}</div>
              </div>
              <VerdictPill verdict={a.verdict} showIcon={false} />
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ── AI Insight panel ─────────────────────────────────────────
function AIInsightPanel({ workspace, onAct }) {
  return (
    <Panel
      title="AI Insight"
      Icon={Icons.Brain}
      iconTone="gold"
      meta="updated 6m ago"
    >
      <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-gold-deep)', marginBottom: 8 }}>
        Top recommendation
      </div>
      <p style={{ fontSize: 13, color: 'var(--c-text-soft)', lineHeight: 1.55, margin: '0 0 14px' }}>
        Your <strong style={{ color: 'var(--c-text-base)' }}>Eid Carousel</strong> ad set is showing creative fatigue at v=4.2 frequency. Lumi recommends pausing it and reallocating to <strong style={{ color: 'var(--c-text-base)' }}>PMax Warm</strong> — historically you've recovered 92% of equivalent spend within 6 days.
      </p>
      <button onClick={onAct} className="btn-gold" style={{ width: '100%', justifyContent: 'center', padding: '10px 14px', fontSize: 13 }}>
        <Icons.Zap style={{ fontSize: 13 }} />
        Review verdict
        <Icons.ArrowRight style={{ fontSize: 13 }} />
      </button>
    </Panel>
  );
}

// ── Quick actions ────────────────────────────────────────────
function QuickActionsPanel({ onStartFlow, onNav }) {
  const actions = [
    { label: 'Upload new CSV',     sub: 'Get a fresh verdict',         Icon: Icons.Upload,    onClick: () => onStartFlow('campaign') },
    { label: 'Fix bleeding copy',  sub: 'Open Content Lab',            Icon: Icons.Send,      onClick: () => onNav('content') },
    { label: 'Plan next 4 weeks',  sub: 'Social Calendar',             Icon: Icons.Calendar,  onClick: () => onNav('calendar') },
    { label: 'Find growth signal', sub: 'Open Growth board',           Icon: Icons.Target,    onClick: () => onNav('growth') },
  ];
  return (
    <Panel title="Quick actions" Icon={Icons.Zap} iconTone="gold" meta={`${actions.length} ready`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={a.onClick}
            className="hover-bg-card hover-border-gold"
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 12px',
              background: 'var(--c-surface-elevated)',
              border: '1px solid var(--c-surface-border)',
              borderRadius: 8, textAlign: 'left', cursor: 'pointer',
              transition: 'all 150ms',
            }}
          >
            <div style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(246,201,69,0.10)', color: 'var(--c-gold-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <a.Icon style={{ fontSize: 14 }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="font-display" style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text-base)' }}>{a.label}</div>
              <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', marginTop: 1 }}>{a.sub}</div>
            </div>
            <Icons.ArrowRight style={{ fontSize: 12, color: 'var(--c-text-subtle)' }} />
          </button>
        ))}
      </div>
    </Panel>
  );
}

// ── Activity feed ────────────────────────────────────────────
function ActivityFeed({ sessions }) {
  return (
    <Panel title="Recent activity" Icon={Icons.History} iconTone="neutral" meta="last 7 days">
      <div>
        {sessions.map((s, i) => (
          <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 180px 110px 60px', gap: 14, padding: '12px 4px', borderBottom: i === sessions.length - 1 ? 'none' : '1px solid var(--c-surface-border)', alignItems: 'center' }}>
            <VerdictPill verdict={s.verdict} />
            <span className="font-display" style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text-base)' }}>{s.label}</span>
            <span className="font-mono tabular-nums" style={{ fontSize: 11, color: 'var(--c-text-soft)' }}>{s.impact}</span>
            <span className="font-mono tabular-nums" style={{ fontSize: 11, fontWeight: 600, color: s.delta.startsWith('+') ? 'var(--c-scale-text)' : 'var(--c-text-muted)' }}>
              {s.delta}
            </span>
            <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)', textAlign: 'right' }}>{s.ts}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ── Panel shell ──────────────────────────────────────────────
function Panel({ title, Icon, iconTone, meta, children }) {
  const tone = {
    gold:    { color: 'var(--c-gold-deep)',   bg: 'rgba(246,201,69,0.10)' },
    kill:    { color: 'var(--c-kill-text)',   bg: 'var(--c-kill-bg)' },
    neutral: { color: 'var(--c-text-soft)',   bg: 'var(--c-surface-elevated)' },
  }[iconTone] || { color: 'var(--c-text-base)', bg: 'var(--c-surface-elevated)' };
  return (
    <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, padding: 18, boxShadow: 'var(--sh-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: tone.bg, color: tone.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon style={{ fontSize: 13 }} />
          </div>
          <span className="font-display" style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--c-text-base)' }}>{title}</span>
        </div>
        {meta && <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-subtle)' }}>{meta}</span>}
      </div>
      {children}
    </div>
  );
}

function EmptyPanel({ text }) {
  return <div style={{ padding: '20px 8px', textAlign: 'center', fontSize: 12, color: 'var(--c-text-muted)' }}>{text}</div>;
}


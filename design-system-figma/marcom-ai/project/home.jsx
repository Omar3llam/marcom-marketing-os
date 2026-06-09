// ============================================================
// Lumi — Home page (account pulse)
// ============================================================
// Replaces the old Command Hub. Account overview with 4 stats,
// alerts panel, AI insight, quick actions, recent activity.
// ============================================================

import { Icons } from './icons.jsx';
import { DEMO_DATA } from './data.js';
import { VerdictPill, formatCurrency, formatCurrencyCompact } from './primitives.jsx';

const SEV_COLOR = { HIGH: 'var(--c-kill, #c0392b)', MEDIUM: 'var(--c-hold-text, #9a6a10)', LOW: 'var(--c-text-muted)' };
const STAGE_COLOR = { ACTIVE: 'var(--c-scale, #1f8a4c)', IDLE: 'var(--c-hold-text, #9a6a10)', STALE: 'var(--c-text-subtle)' };
const HEALTH_COLOR = { HEALTHY: 'var(--c-scale-text, #1f8a4c)', DEGRADED: 'var(--c-hold-text, #9a6a10)', STALLED: 'var(--c-kill, #c0392b)' };
const ACTION_VERB = { confirm: 'Confirm', review: 'Review', adjust: 'Adjust' };

export function HomePage({ workspace, radarAlerts, sessions, onNav, onReviewAlert, onStartFlow, role = 'STRATEGIST', onRunSweep }) {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const persona = workspace?.id ?? 'apparel';
  const home = DEMO_DATA.AGENT_HOME_BY_WS?.[persona] ?? DEMO_DATA.AGENT_HOME_BY_WS?.apparel;
  const highAlerts = radarAlerts.filter((a) => a.priority === 'HIGH');
  const stats = {
    spend:  `${formatCurrencyCompact(workspace.spendMonthlyMinor, workspace.currency)} / mo`,
    cpa:    workspace.benchmarks?.avgCpaMinor != null
              ? formatCurrency(workspace.benchmarks.avgCpaMinor, workspace.currency)
              : `${workspace.currency} —`,
    waste:  formatCurrency(highAlerts.reduce((s, a) => s + (a.bleedWeeklyMinor ?? 0), 0), workspace.currency) + '/wk',
    health: workspace.healthScore ?? 72,
  };

  // A proposal's Confirm launches the existing decision motion (coherence).
  const confirmItem = (item) => onReviewAlert?.({ id: item.id, campaign: item.title, verdict: item.verdict ?? 'WATCH', signal: item.rationale });
  const showBuyer = role !== 'CLIENT';

  return (
    <div data-screen-label="Home" style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 32px 24px' }}>
      <header style={{ marginBottom: 18 }}>
        <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icons.Radar style={{ fontSize: 13, color: 'var(--c-gold)' }} />
          Lumi is running the loop · {workspace.name}
        </div>
        <h1 className="font-display" style={{ fontWeight: 700, fontSize: 34, letterSpacing: '-0.03em', margin: 0, color: 'var(--c-text-base)', lineHeight: 1.1 }}>
          {greeting}. {home.summary}
        </h1>
      </header>

      {/* The closed-loop status bar — Lumi proposes, you confirm. */}
      <LoopStatusBar loop={home.loop} onRunSweep={onRunSweep} />

      {/* Two altitudes, one home. */}
      <div style={{ display: 'grid', gridTemplateColumns: showBuyer ? '1fr 1fr' : '1fr', gap: 14, margin: '18px 0 24px' }}>
        {showBuyer && <AgendaBand band={home.buyerBand} Icon={Icons.Zap} tone="gold" onAct={confirmItem} />}
        <AgendaBand band={home.strategistBand} Icon={Icons.TrendingUp} tone="neutral" onAct={(i) => onNav('plan')} />
      </div>

      {/* The Proof Engine (Phase X) — does Lumi actually get sharper as it learns?
          Calibration, gated: a number only when coverage is RELIABLE. */}
      <ProofBar proof={home.proof} accuracy={DEMO_DATA.ACCURACY_BY_WS?.[persona]} />

      {/* Account-pulse strip (context, not the headline). */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        <StatCard label="Total spend" value={stats.spend} Icon={Icons.BarChart} sub="last 30 days" />
        <StatCard label="Blended CPA" value={stats.cpa} Icon={Icons.Target} sub="↓ 8% vs prev" tone="positive" />
        <StatCard label="Wasted spend" value={stats.waste} Icon={Icons.AlertTriangle} sub="2 bleeding ad sets" tone="danger" />
        <StatCard label="Account health" value={`${stats.health}/100`} Icon={Icons.Activity} sub="Fair — needs review" tone="warn" gauge={stats.health} />
      </div>

      {/* Recent activity */}
      <ActivityFeed sessions={sessions} />
    </div>
  );
}

// ── Proof Engine bar (Phase X) ───────────────────────────────
// "Does Lumi get sharper as it learns your account?" The honest answer:
// calibration error falling over time, GATED — below RELIABLE coverage we show
// only "still learning", never a calibration number. The reliability table is
// the evidence (a table, not a chart — the anti-Looker guard still holds).
function ProofBar({ proof, accuracy }) {
  if (!proof) return null;
  const reliable = !proof.gated;
  const bins = reliable ? (accuracy?.calibration?.bins ?? []) : [];
  const vel = reliable ? (accuracy?.velocity?.periods ?? []) : [];
  return (
    <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, padding: '14px 18px', marginBottom: 24, boxShadow: 'var(--sh-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icons.Target style={{ fontSize: 14, color: reliable ? 'var(--c-gold)' : 'var(--c-text-muted)' }} />
        <span className="font-mono" style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>Decision accuracy · proof of learning</span>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: reliable ? 16 : 13, fontWeight: reliable ? 600 : 500, color: reliable ? 'var(--c-text-base)' : 'var(--c-text-muted)', lineHeight: 1.35 }}>
        {proof.headline}
      </p>
      {reliable && vel.length > 0 && (
        <div className="font-mono" style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 11, color: 'var(--c-text-muted)' }}>
          {vel.map((p) => (
            <span key={p.label}>{p.label}: <strong style={{ color: 'var(--c-text-base)' }}>{Math.round(p.calibrationError * 100)}%</strong> err</span>
          ))}
        </div>
      )}
      {reliable && bins.length > 0 && (
        <table style={{ width: '100%', marginTop: 12, borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: 'var(--c-text-muted)', textAlign: 'left' }}>
              <th style={{ padding: '4px 8px', fontWeight: 600 }}>Confidence band</th>
              <th style={{ padding: '4px 8px', fontWeight: 600 }}>Lumi said</th>
              <th style={{ padding: '4px 8px', fontWeight: 600 }}>Actually right</th>
              <th style={{ padding: '4px 8px', fontWeight: 600 }}>n</th>
            </tr>
          </thead>
          <tbody>
            {bins.map((b) => (
              <tr key={b.band} style={{ borderTop: '1px solid var(--c-surface-border)' }}>
                <td className="font-mono" style={{ padding: '4px 8px' }}>{b.band}</td>
                <td className="font-mono" style={{ padding: '4px 8px' }}>{Math.round(b.predicted * 100)}%</td>
                <td className="font-mono" style={{ padding: '4px 8px', color: 'var(--c-text-base)' }}>{Math.round(b.observed * 100)}%</td>
                <td className="font-mono" style={{ padding: '4px 8px', color: 'var(--c-text-muted)' }}>{b.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Closed-loop status bar ───────────────────────────────────
// The six stages plan→allocate→execute→test→measure→learn, each with its
// freshness. Makes the loop visibly closed. A status strip, NOT a chart.
function LoopStatusBar({ loop, onRunSweep }) {
  return (
    <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, padding: '14px 18px', boxShadow: 'var(--sh-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: HEALTH_COLOR[loop.loopHealth] }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: HEALTH_COLOR[loop.loopHealth] }} />
          {loop.closed ? 'Loop closed' : 'Loop ' + loop.loopHealth.toLowerCase()}
        </span>
        <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>swept {loop.lastRunAt} · next {loop.nextRunAt}</span>
        <button onClick={onRunSweep} className="hover-border-gold" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--c-surface-border)', background: 'var(--c-surface-elevated)', color: 'var(--c-text-base)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          <Icons.Radar style={{ fontSize: 13 }} /> Run sweep now
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        {loop.stageStatus.map((s, i) => (
          <React.Fragment key={s.stage}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, minWidth: 84 }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: STAGE_COLOR[s.state], boxShadow: s.state === 'ACTIVE' ? `0 0 0 4px ${STAGE_COLOR.ACTIVE}22` : 'none' }} />
              <span className="font-mono" style={{ fontSize: 9, letterSpacing: '0.05em', textTransform: 'uppercase', color: s.state === 'STALE' ? 'var(--c-text-subtle)' : 'var(--c-text-muted)' }}>{s.stage}</span>
            </div>
            {i < loop.stageStatus.length - 1 && (
              <div style={{ flex: 1, height: 2, background: s.state === 'STALE' ? 'var(--c-surface-border)' : STAGE_COLOR.ACTIVE, opacity: 0.5, margin: '0 -2px', marginBottom: 14 }} />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ── Agenda band (buyer or strategist) ────────────────────────
function AgendaBand({ band, Icon, tone, onAct }) {
  return (
    <Panel title={band.title} Icon={Icon} iconTone={tone} meta={`${band.items.length} item${band.items.length === 1 ? '' : 's'}`}>
      {band.items.length === 0 ? (
        <EmptyPanel text="Nothing here needs you right now." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {band.items.map((item) => (
            <button
              key={item.id}
              onClick={() => onAct?.(item)}
              className="hover-bg-card"
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 12px',
                background: 'var(--c-surface-elevated)', border: '1px solid var(--c-surface-border)',
                borderLeft: `3px solid ${SEV_COLOR[item.severity]}`, borderRadius: 8, textAlign: 'left',
                cursor: 'pointer', transition: 'background 120ms',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="font-display" style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-base)' }}>{item.title}</div>
                <div style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 3, lineHeight: 1.45 }}>{item.rationale}</div>
              </div>
              <span className="font-mono" style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '4px 9px', borderRadius: 6, background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', color: 'var(--c-text-base)' }}>
                {ACTION_VERB[item.humanAction] ?? 'Open'}
              </span>
            </button>
          ))}
        </div>
      )}
    </Panel>
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


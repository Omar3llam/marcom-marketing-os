// ============================================================
// Lumi — Campaigns page (upgraded from CampaignsList)
// ============================================================
// Table + right-slide detail panel. Click any row → opens panel
// with diagnosis + Fix Content / Adjust Budget CTAs.
// ============================================================

function CampaignsPage({ workspace, alerts, onStartFlow, onReviewAlert, onFixContent }) {
  const [selectedId, setSelectedId] = React.useState(null);
  const [filter, setFilter] = React.useState('All');

  // Guard: reset selection when the selected item disappears from the list
  React.useEffect(() => {
    if (selectedId && !alerts.some((a) => a.id === selectedId)) {
      setSelectedId(null);
    }
  }, [alerts, selectedId]);

  // Derive filtered list from raw alerts
  const filteredAlerts = React.useMemo(
    () =>
      filter === 'All'
        ? alerts
        : alerts.filter((a) => a.verdict === filter),
    [alerts, filter],
  );

  const selected = React.useMemo(
    () => filteredAlerts.find((a) => a.id === selectedId) ?? null,
    [filteredAlerts, selectedId],
  );

  return (
    <div data-screen-label="Campaigns" style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 32px 24px', position: 'relative' }}>
      <header style={{ marginBottom: 20 }}>
        <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 8 }}>
          Campaigns · {workspace.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <h1 className="font-display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, color: 'var(--c-text-base)' }}>
            {filteredAlerts.length} active campaigns · {alerts.filter((a) => a.priority === 'HIGH').length} need attention.
          </h1>
          <button className="btn-gold" onClick={() => onStartFlow('campaign')}>
            <Icons.Upload style={{ fontSize: 14 }} />
            Upload new data
          </button>
        </div>
      </header>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {['All','KILL','HOLD','SCALE'].map((f) => {
          const isActive = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="font-mono"
              style={{
                padding: '6px 12px',
                background: isActive ? 'var(--c-lumi-elevated)' : 'var(--c-surface-card)',
                border: '1px solid var(--c-surface-border)',
                color: isActive ? 'var(--c-text-base)' : 'var(--c-text-muted)',
                borderRadius: 999, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer',
              }}
            >
              {f === 'All' ? `All · ${alerts.length}` : f}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--sh-card)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 120px 110px 110px 110px 32px', gap: 14, padding: '12px 18px', background: 'var(--c-surface-elevated)', borderBottom: '1px solid var(--c-surface-border)' }}>
          {['Verdict','Campaign / Ad set','Stage','Health','Bleed','Time',''].map((h) => (
            <span key={h} className="font-mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>{h}</span>
          ))}
        </div>
        {filteredAlerts.map((a) => {
          const isSelected = a.id === selectedId;
          const health = a.verdict === 'KILL' ? 28 : a.verdict === 'HOLD' ? 56 : 82;
          return (
            <div
              key={a.id}
              onClick={() => setSelectedId(a.id)}
              style={{
                display: 'grid',
                gridTemplateColumns: '90px 1fr 120px 110px 110px 110px 32px',
                gap: 14, padding: '14px 18px',
                borderBottom: '1px solid var(--c-surface-border)',
                alignItems: 'center',
                cursor: 'pointer',
                background: isSelected ? 'rgba(246,201,69,0.04)' : 'transparent',
                borderLeft: isSelected ? '3px solid var(--c-gold)' : '3px solid transparent',
                paddingLeft: isSelected ? 15 : 18,
                transition: 'all 150ms',
              }}
              onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--c-surface-elevated)'; }}
              onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
            >
              <VerdictPill verdict={a.verdict} />
              <div>
                <div className="font-display" style={{ fontWeight: 500, fontSize: 14, color: 'var(--c-text-base)' }}>{a.campaign}</div>
                <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 2 }}>{a.adset} · {a.signal}</div>
              </div>
              <StagePill stage={a.stage} />
              <HealthBar pct={health} />
              <span className="font-mono tabular-nums" style={{ fontSize: 12, color: a.bleed !== '—' ? 'var(--c-kill-text)' : 'var(--c-text-muted)' }}>{a.bleed}</span>
              <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>{a.time}</span>
              <Icons.ChevronRight style={{ fontSize: 14, color: 'var(--c-text-subtle)' }} />
            </div>
          );
        })}
      </div>

      {/* Detail panel */}
      {selected && (
        <DetailPanel
          alert={selected}
          workspace={workspace}
          onClose={() => setSelectedId(null)}
          onReviewVerdict={() => onReviewAlert(selected)}
          onFixContent={() => onFixContent(selected)}
        />
      )}
    </div>
  );
}

function HealthBar({ pct }) {
  const color = pct < 40 ? 'var(--c-kill)' : pct < 70 ? 'var(--c-hold)' : 'var(--c-scale)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 60, height: 4, borderRadius: 2, background: 'var(--c-surface-border)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span className="font-mono tabular-nums" style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-text-base)' }}>{pct}</span>
    </div>
  );
}

// ── MetricRow component ───────────────────────────────────────
function MetricRow({ label, value, trend, status, delta, context }) {
  // Status-based coloring
  const statusColor = status === 'danger' ? 'var(--c-kill-text)'
                    : status === 'warning' ? 'var(--c-hold-text)'
                    : status === 'success' ? 'var(--c-scale-text)'
                    : 'var(--c-text-base)';

  // Trend indicator
  const trendSymbol = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '';

  return (
    <div style={{ padding: '10px 12px', background: 'var(--c-surface-elevated)', borderRadius: 8 }}>
      <div className="font-mono" style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 3 }}>
        <span className="font-mono tabular-nums" style={{ fontSize: 14, fontWeight: 700, color: statusColor }}>
          {value ?? '—'}
        </span>
        {trendSymbol && (
          <span style={{ fontSize: 11, color: statusColor }}>{trendSymbol}</span>
        )}
      </div>
      {delta && (
        <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', marginTop: 2 }}>
          {delta}
        </div>
      )}
      {context && (
        <div style={{ fontSize: 10, color: 'var(--c-text-subtle)', marginTop: 3, lineHeight: 1.3 }}>
          {context}
        </div>
      )}
    </div>
  );
}

// ── MemoryEntry component ─────────────────────────────────────
function MemoryEntry({ actionType, rationale, sustainable, durationHrs }) {
  const sustainableLabel = sustainable === true ? 'Sustained'
                         : sustainable === false ? 'Temporary'
                         : 'Unknown';

  const sustainableColor = sustainable === true ? 'var(--c-scale-text)'
                         : sustainable === false ? 'var(--c-hold-text)'
                         : 'var(--c-text-muted)';

  return (
    <div style={{ padding: '12px 14px', background: 'var(--c-surface-elevated)', border: '1px solid var(--c-surface-border)', borderRadius: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)', fontWeight: 600 }}>
          {actionType ?? 'DECISION'}
        </span>
        <span style={{ fontSize: 10, color: sustainableColor, fontWeight: 600 }}>
          {sustainableLabel}
        </span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--c-text-soft)', fontStyle: 'italic', lineHeight: 1.55, margin: 0 }}>
        "{rationale ?? 'No rationale provided.'}"
      </p>
      {durationHrs != null && (
        <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-subtle)', marginTop: 6 }}>
          Impact duration: {durationHrs}h
        </div>
      )}
    </div>
  );
}

// ── Right-slide detail panel ─────────────────────────────────
function DetailPanel({ alert, workspace, onClose, onReviewVerdict, onFixContent }) {
  // Top-level guard for missing alert
  if (!alert) return null;

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const health = alert.verdict === 'KILL' ? 28 : alert.verdict === 'HOLD' ? 56 : 82;
  const verdictColor = alert.verdict === 'KILL' ? 'var(--c-kill-text)' : alert.verdict === 'SCALE' ? 'var(--c-scale-text)' : 'var(--c-hold-text)';

  return (
    <>
      {/* backdrop */}
      <div
        onClick={onClose}
        className="anim-fade-in"
        style={{
          position: 'fixed', inset: 0, zIndex: 40,
          background: 'rgba(15,15,20,0.25)',
        }}
      />
      <aside
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0,
          zIndex: 50,
          width: 460,
          maxWidth: '90vw',
          background: 'var(--c-surface-card)',
          borderLeft: '1px solid var(--c-surface-border)',
          boxShadow: '-20px 0 40px rgba(0,0,0,0.10)',
          display: 'flex', flexDirection: 'column',
          animation: 'detail-slide 280ms cubic-bezier(0.16,1,0.3,1) both',
        }}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--c-surface-border)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 6 }}>
                Campaign · {alert.time}
              </div>
              <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em', margin: 0, color: 'var(--c-text-base)', lineHeight: 1.3 }}>
                {alert.campaign}
              </h2>
              <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 4 }}>{alert.adset}</div>
            </div>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', padding: 6, color: 'var(--c-text-muted)', cursor: 'pointer', display: 'flex' }}>
              <Icons.X style={{ fontSize: 16 }} />
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14 }}>
            <StagePill stage={alert.stage} />
            <span style={{ color: 'var(--c-text-subtle)' }}>·</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Health</span>
              <HealthBar pct={health} />
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {/* Performance */}
          <Section title="Performance" hint="last 14 days">
            {alert.metrics && alert.metrics.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10 }}>
                {alert.metrics.map((m) => (
                  <MetricRow
                    key={m.metric}
                    label={m.metric}
                    value={m.value}
                    trend={m.trend}
                    status={m.status}
                    delta={m.delta}
                    context={m.context}
                  />
                ))}
              </div>
            ) : (
              <div style={{ padding: '14px 16px', background: 'var(--c-surface-elevated)', border: '1px solid var(--c-surface-border)', borderRadius: 10, fontSize: 12, color: 'var(--c-text-muted)', textAlign: 'center' }}>
                No metrics available for this campaign.
              </div>
            )}
          </Section>

          {/* AI Diagnosis */}
          <Section title="AI Diagnosis" Icon={Icons.Brain}>
            <div style={{ padding: '14px 16px', background: 'rgba(246,201,69,0.06)', border: '1px solid rgba(246,201,69,0.25)', borderRadius: 10 }}>
              <p style={{ fontSize: 13, color: 'var(--c-text-soft)', margin: 0, lineHeight: 1.55, marginBottom: 8 }}>
                {alert.historical_insight ?? 'No historical insight available.'}
              </p>
              {alert.analysis?.root_cause && (
                <p style={{ fontSize: 12, color: 'var(--c-text-muted)', margin: 0, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                  Root cause: {alert.analysis.root_cause}
                </p>
              )}
            </div>
          </Section>

          {/* Recommended action */}
          <Section title="Recommended action">
            <div style={{ padding: '14px 16px', background: 'rgba(246,201,69,0.06)', border: '1px solid rgba(246,201,69,0.25)', borderRadius: 10, marginBottom: 12 }}>
              <p style={{ fontSize: 13, color: 'var(--c-text-soft)', margin: 0, lineHeight: 1.55 }}>
                {alert.action_plan?.action ?? 'Awaiting analysis.'}
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={onFixContent} className="btn-gold" style={{ width: '100%', justifyContent: 'flex-start', padding: '12px 14px', fontSize: 13 }}>
                <Icons.Send style={{ fontSize: 14 }} />
                Fix content in Content Lab
                <Icons.ArrowRight style={{ fontSize: 13, marginLeft: 'auto' }} />
              </button>
              <button onClick={onReviewVerdict} className="btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', padding: '11px 14px', fontSize: 13 }}>
                <Icons.BarChart style={{ fontSize: 14 }} />
                Adjust budget · review verdict
                <Icons.ArrowRight style={{ fontSize: 13, marginLeft: 'auto' }} />
              </button>
            </div>
          </Section>

          {/* Decision memory */}
          <Section title="Decision memory" Icon={Icons.Database}>
            {alert.memory && alert.memory.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {alert.memory.map((entry, i) => (
                  <MemoryEntry
                    key={i}
                    actionType={entry.actionType}
                    rationale={entry.decisionRationale}
                    sustainable={entry.isSustainable}
                    durationHrs={entry.impactDurationHrs}
                  />
                ))}
              </div>
            ) : (
              <div style={{ padding: '12px 14px', background: 'var(--c-surface-elevated)', border: '1px solid var(--c-surface-border)', borderRadius: 10, fontSize: 12, color: 'var(--c-text-muted)', textAlign: 'center' }}>
                No decision history available.
              </div>
            )}
          </Section>
        </div>
      </aside>

      <style>{`
        @keyframes detail-slide {
          from { transform: translateX(40px); opacity: 0; }
          to   { transform: translateX(0);     opacity: 1; }
        }
      `}</style>
    </>
  );
}

function Section({ title, Icon, hint, children }) {
  return (
    <section style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {Icon && <Icon style={{ fontSize: 13, color: 'var(--c-gold-deep)' }} />}
          <span className="section-label">{title}</span>
        </div>
        {hint && <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-subtle)' }}>{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div style={{ padding: '10px 12px', background: 'var(--c-surface-elevated)', borderRadius: 8 }}>
      <div className="font-mono" style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>{label}</div>
      <div className="font-mono tabular-nums" style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-text-base)', marginTop: 3 }}>{value}</div>
    </div>
  );
}

window.CampaignsPage = CampaignsPage;

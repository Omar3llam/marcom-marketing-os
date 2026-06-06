// ============================================================
// Lumi — Campaigns page (upgraded from CampaignsList)
// ============================================================
// Table + right-slide detail panel. Click any row → opens panel
// with diagnosis + Fix Content / Adjust Budget CTAs.
// ============================================================

import { Icons } from './icons.jsx';
import { VerdictPill, StagePill, formatBleed } from './primitives.jsx';

export function CampaignsPage({ workspace, alerts, loading = false, onStartFlow, onReviewAlert, onFixContent }) {
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

  // Memoize summary stats (total + by-verdict counts)
  const summary = React.useMemo(() => {
    return alerts.reduce(
      (acc, a) => {
        acc.total += 1;
        if (a.priority === 'HIGH') acc.needAttention += 1;
        if (a.verdict === 'KILL') acc.KILL += 1;
        if (a.verdict === 'HOLD') acc.HOLD += 1;
        if (a.verdict === 'SCALE') acc.SCALE += 1;
        return acc;
      },
      { total: 0, needAttention: 0, KILL: 0, HOLD: 0, SCALE: 0 },
    );
  }, [alerts]);

  // Stable callbacks to prevent event listener churn + row re-renders
  const handleClose = React.useCallback(() => setSelectedId(null), []);
  const handleReviewAlert = React.useCallback(() => onReviewAlert(selected), [onReviewAlert, selected]);
  const handleFixContent = React.useCallback(() => onFixContent(selected), [onFixContent, selected]);
  const handleSelectRow = React.useCallback((id) => setSelectedId(id), []);
  const handleRowKeyDown = React.useCallback((e, id) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelectedId(id);
    }
  }, []);

  // FIX 1: Loading skeleton
  if (loading) {
    return (
      <div data-screen-label="Campaigns" style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 32px 24px' }}>
        <header style={{ marginBottom: 20 }}>
          <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 8 }}>
            Campaigns · {workspace?.name ?? 'Loading...'}
          </div>
          <div className="skeleton-pulse" style={{ width: 320, height: 36, background: 'var(--c-surface-elevated)', borderRadius: 8, marginBottom: 12 }} />
        </header>

        <div className="campaigns-skeleton" role="status" aria-busy="true" aria-label="Loading campaigns">
          <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--sh-card)', padding: '18px' }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="skeleton-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '90px 1fr 120px 110px 110px 110px 32px',
                  gap: 14,
                  padding: '14px 0',
                  alignItems: 'center',
                  borderBottom: i < 4 ? '1px solid var(--c-surface-border)' : 'none',
                }}
              >
                <div className="skeleton-pulse" style={{ width: 70, height: 24, background: 'var(--c-surface-elevated)', borderRadius: 6 }} />
                <div>
                  <div className="skeleton-pulse" style={{ width: '60%', height: 14, background: 'var(--c-surface-elevated)', borderRadius: 4, marginBottom: 6 }} />
                  <div className="skeleton-pulse" style={{ width: '40%', height: 11, background: 'var(--c-surface-elevated)', borderRadius: 4 }} />
                </div>
                <div className="skeleton-pulse" style={{ width: 80, height: 20, background: 'var(--c-surface-elevated)', borderRadius: 6 }} />
                <div className="skeleton-pulse" style={{ width: 60, height: 12, background: 'var(--c-surface-elevated)', borderRadius: 4 }} />
                <div className="skeleton-pulse" style={{ width: 50, height: 12, background: 'var(--c-surface-elevated)', borderRadius: 4 }} />
                <div className="skeleton-pulse" style={{ width: 40, height: 11, background: 'var(--c-surface-elevated)', borderRadius: 4 }} />
                <div className="skeleton-pulse" style={{ width: 16, height: 16, background: 'var(--c-surface-elevated)', borderRadius: 3 }} />
              </div>
            ))}
          </div>
        </div>

        <style>{`
          @keyframes skeleton-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
          .skeleton-pulse {
            animation: skeleton-pulse 1.5s ease-in-out infinite;
          }
        `}</style>
      </div>
    );
  }

  // FIX 2: Empty state
  if (!loading && filteredAlerts.length === 0) {
    const isFiltered = filter !== 'All';
    return (
      <div data-screen-label="Campaigns" style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 32px 24px' }}>
        <header style={{ marginBottom: 20 }}>
          <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 8 }}>
            Campaigns · {workspace?.name ?? 'Loading...'}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <h1 className="font-display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, color: 'var(--c-text-base)' }}>
              0 active campaigns · 0 need attention.
            </h1>
            <button type="button" className="btn-gold" onClick={() => onStartFlow('campaign')}>
              <Icons.Upload style={{ fontSize: 14 }} aria-hidden="true" />
              Upload new data
            </button>
          </div>
        </header>

        {/* Show filter chips when filtered */}
        {isFiltered && (
          <div role="group" aria-label="Campaign filters" style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {['All','KILL','HOLD','SCALE'].map((f) => {
              const isActive = filter === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  aria-label={`Filter by ${f}`}
                  aria-pressed={isActive ? 'true' : 'false'}
                  className="font-mono"
                  style={{
                    padding: '6px 12px',
                    background: isActive ? 'var(--c-lumi-elevated)' : 'var(--c-surface-card)',
                    border: '1px solid var(--c-surface-border)',
                    color: isActive ? 'var(--c-text-base)' : 'var(--c-text-muted)',
                    borderRadius: 999, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer',
                  }}
                >
                  {f === 'All' ? `All · 0` : f}
                </button>
              );
            })}
          </div>
        )}

        <div
          role="status"
          style={{
            background: 'var(--c-surface-card)',
            border: isFiltered ? '1px solid var(--c-hold)' : '1px dashed var(--c-surface-border)',
            borderRadius: 14,
            padding: '64px 32px',
            textAlign: 'center',
            boxShadow: 'var(--sh-card)',
          }}
        >
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: 12, background: isFiltered ? 'rgba(246,201,69,0.08)' : 'var(--c-surface-elevated)', border: '1px solid var(--c-surface-border)', marginBottom: 16 }}>
            {isFiltered ? (
              <Icons.Filter style={{ fontSize: 24, color: 'var(--c-gold)' }} />
            ) : (
              <Icons.BarChart style={{ fontSize: 24, color: 'var(--c-text-muted)' }} />
            )}
          </div>
          <h3 className="font-display" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--c-text-base)', marginBottom: 8 }}>
            {isFiltered ? `No ${filter} campaigns` : 'No campaigns detected'}
          </h3>
          <p style={{ fontSize: 13, color: 'var(--c-text-muted)', maxWidth: 400, margin: '0 auto 20px', lineHeight: 1.5 }}>
            {isFiltered
              ? `All campaigns are currently filtered out. Try selecting 'All'.`
              : 'Upload your campaign CSV to begin Lumi analysis.'}
          </p>
          {isFiltered && (
            <button
              type="button"
              onClick={() => setFilter('All')}
              className="btn-ghost"
              style={{ padding: '10px 20px', fontSize: 13 }}
            >
              <Icons.X style={{ fontSize: 14 }} aria-hidden="true" />
              Clear filter
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div data-screen-label="Campaigns" style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 32px 24px', position: 'relative' }}>
      <header style={{ marginBottom: 20 }}>
        <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 8 }}>
          Campaigns · {workspace?.name ?? 'Loading...'}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <h1 className="font-display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, color: 'var(--c-text-base)' }}>
            {filteredAlerts.length} active campaigns · {summary.needAttention} need attention.
          </h1>
          <button type="button" className="btn-gold" onClick={() => onStartFlow('campaign')}>
            <Icons.Upload style={{ fontSize: 14 }} aria-hidden="true" />
            Upload new data
          </button>
        </div>
      </header>

      {/* Filter chips */}
      <div role="group" aria-label="Campaign filters" style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {['All','KILL','HOLD','SCALE'].map((f) => {
          const isActive = filter === f;
          const pressedState = isActive ? 'true' : 'false';
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-label={`Filter by ${f}`}
              aria-pressed={pressedState}
              className="font-mono"
              style={{
                padding: '6px 12px',
                background: isActive ? 'var(--c-lumi-elevated)' : 'var(--c-surface-card)',
                border: '1px solid var(--c-surface-border)',
                color: isActive ? 'var(--c-text-base)' : 'var(--c-text-muted)',
                borderRadius: 999, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer',
              }}
            >
              {f === 'All' ? `All · ${summary.total}` : f}
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
          const expandedState = isSelected ? 'true' : 'false';
          const controlsId = isSelected ? 'campaign-detail-panel' : undefined;
          return (
            <div
              key={a.id}
              role="button"
              tabIndex={0}
              onClick={() => handleSelectRow(a.id)}
              onKeyDown={(e) => handleRowKeyDown(e, a.id)}
              aria-label={`View details for ${a.campaign}`}
              aria-expanded={expandedState}
              aria-controls={controlsId}
              className="campaign-row"
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
            >
              <VerdictPill verdict={a.verdict} />
              <div>
                <div className="font-display" style={{ fontWeight: 500, fontSize: 14, color: 'var(--c-text-base)' }}>{a.campaign}</div>
                <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 2 }}>{a.adset} · {a.signal}</div>
              </div>
              <StagePill stage={a.stage} />
              <HealthBar pct={health} />
              <span className="font-mono tabular-nums" style={{ fontSize: 12, color: a.bleedDailyMinor != null ? 'var(--c-kill-text)' : 'var(--c-text-muted)' }}>{formatBleed(a.bleedDailyMinor, workspace?.currency)}</span>
              <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>{a.time}</span>
              <Icons.ChevronRight style={{ fontSize: 14, color: 'var(--c-text-subtle)' }} aria-hidden="true" />
            </div>
          );
        })}
      </div>

      {/* Detail panel */}
      {selected && (
        <DetailPanel
          alert={selected}
          workspace={workspace}
          onClose={handleClose}
          onReviewVerdict={handleReviewAlert}
          onFixContent={handleFixContent}
        />
      )}

      <style>{`
        .campaign-row:not([style*="rgba(246,201,69"]):hover {
          background: var(--c-surface-elevated) !important;
        }
      `}</style>
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

  // FIX 2: Stable event listener via ref to prevent re-registration churn
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // stable — never re-registers

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
        id="campaign-detail-panel"
        role="complementary"
        aria-label="Campaign detail"
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
            <button type="button" onClick={onClose} aria-label="Close detail panel" style={{ background: 'transparent', border: 'none', padding: 6, color: 'var(--c-text-muted)', cursor: 'pointer', display: 'flex' }}>
              <Icons.X style={{ fontSize: 16 }} aria-hidden="true" />
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
              <button type="button" onClick={onFixContent} className="btn-gold" style={{ width: '100%', justifyContent: 'flex-start', padding: '12px 14px', fontSize: 13 }}>
                <Icons.Send style={{ fontSize: 14 }} aria-hidden="true" />
                Fix content in Content Lab
                <Icons.ArrowRight style={{ fontSize: 13, marginLeft: 'auto' }} aria-hidden="true" />
              </button>
              <button type="button" onClick={onReviewVerdict} className="btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', padding: '11px 14px', fontSize: 13 }}>
                <Icons.BarChart style={{ fontSize: 14 }} aria-hidden="true" />
                Adjust budget · review verdict
                <Icons.ArrowRight style={{ fontSize: 13, marginLeft: 'auto' }} aria-hidden="true" />
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


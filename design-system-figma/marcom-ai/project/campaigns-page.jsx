// ============================================================
// Lumi — Campaigns page (upgraded from CampaignsList)
// ============================================================
// Table + right-slide detail panel. Click any row → opens panel
// with diagnosis + Fix Content / Adjust Budget CTAs.
// ============================================================

function CampaignsPage({ workspace, alerts, onStartFlow, onReviewAlert, onFixContent }) {
  const [selectedId, setSelectedId] = React.useState(null);
  const selected = alerts.find((a) => a.id === selectedId);

  return (
    <div data-screen-label="Campaigns" style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 32px 24px', position: 'relative' }}>
      <header style={{ marginBottom: 20 }}>
        <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 8 }}>
          Campaigns · {workspace.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <h1 className="font-display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, color: 'var(--c-text-base)' }}>
            {alerts.length} active campaigns · {alerts.filter((a) => a.priority === 'HIGH').length} need attention.
          </h1>
          <button className="btn-gold" onClick={() => onStartFlow('campaign')}>
            <Icons.Upload style={{ fontSize: 14 }} />
            Upload new data
          </button>
        </div>
      </header>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {['All','KILL','HOLD','SCALE'].map((f, i) => (
          <button
            key={f}
            className="font-mono"
            style={{
              padding: '6px 12px',
              background: i === 0 ? 'var(--c-lumi-elevated)' : 'var(--c-surface-card)',
              border: '1px solid var(--c-surface-border)',
              color: i === 0 ? 'var(--c-text-base)' : 'var(--c-text-muted)',
              borderRadius: 999, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer',
            }}
          >
            {f === 'All' ? `All · ${alerts.length}` : f}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--sh-card)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 120px 110px 110px 110px 32px', gap: 14, padding: '12px 18px', background: 'var(--c-surface-elevated)', borderBottom: '1px solid var(--c-surface-border)' }}>
          {['Verdict','Campaign / Ad set','Stage','Health','Bleed','Time',''].map((h) => (
            <span key={h} className="font-mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>{h}</span>
          ))}
        </div>
        {alerts.map((a) => {
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

// ── Right-slide detail panel ─────────────────────────────────
function DetailPanel({ alert, workspace, onClose, onReviewVerdict, onFixContent }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const health = alert.verdict === 'KILL' ? 28 : alert.verdict === 'HOLD' ? 56 : 82;
  const verdictColor = alert.verdict === 'KILL' ? 'var(--c-kill-text)' : alert.verdict === 'SCALE' ? 'var(--c-scale-text)' : 'var(--c-hold-text)';

  // Demo metrics
  const metrics = {
    KILL:  { spend: '84.3k',  ctr: '0.84%', roas: '0.6x', freq: '4.2' },
    HOLD:  { spend: '32.1k',  ctr: '1.10%', roas: '1.8x', freq: '3.1' },
    SCALE: { spend: '21.7k',  ctr: '2.45%', roas: '4.8x', freq: '1.9' },
  }[alert.verdict] || { spend: '—', ctr: '—', roas: '—', freq: '—' };

  const diagnosis = {
    KILL:  'Creative fatigue detected. Hook isn\'t engaging in the first 3 seconds. CPA is 73% above target and worsening 7 days running.',
    HOLD:  'Volume is holding but CTR fragile. 48h re-scan recommended before any spend changes.',
    SCALE: 'Stable ROAS at 4.8x for 6 days. Audience hasn\'t saturated. Safe to lift 2× and monitor frequency.',
  }[alert.verdict] || '';

  const memory = {
    KILL:  'Last image swap had 24h impact only. Reallocation to PMax warm recovered 92% of equivalent spend within 6 days.',
    HOLD:  'Two prior HOLDs on cold MENA audiences resolved to KILL within 4 days. Watch the next 48h closely.',
    SCALE: 'Three prior SCALEs at 2× lift maintained ROAS for 8+ days. One needed pull-back at 10 days.',
  }[alert.verdict] || '';

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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              <Metric label="Spend"     value={`${workspace.currency} ${metrics.spend}`} />
              <Metric label="CTR"       value={metrics.ctr} />
              <Metric label="ROAS"      value={metrics.roas} />
              <Metric label="Frequency" value={metrics.freq} />
            </div>
          </Section>

          {/* AI Diagnosis */}
          <Section title="AI Diagnosis" Icon={Icons.Brain}>
            <div style={{ padding: '14px 16px', background: 'rgba(246,201,69,0.06)', border: '1px solid rgba(246,201,69,0.25)', borderRadius: 10 }}>
              <p style={{ fontSize: 13, color: 'var(--c-text-soft)', margin: 0, lineHeight: 1.55 }}>
                {diagnosis}
              </p>
            </div>
          </Section>

          {/* Recommended action */}
          <Section title="Recommended action">
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
            <div style={{ padding: '12px 14px', background: 'var(--c-surface-elevated)', border: '1px solid var(--c-surface-border)', borderRadius: 10, fontSize: 12, color: 'var(--c-text-soft)', fontStyle: 'italic', lineHeight: 1.55 }}>
              "{memory}"
            </div>
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

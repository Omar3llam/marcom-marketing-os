// ============================================================
// MARCOM Demo — Command Hub (the war-room home view)
// ============================================================

function CommandHub({ workspace, radarAlerts, sessions, onStartFlow, onReviewAlert }) {
  return (
    <div data-screen-label="Command Hub" style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 32px 24px' }}>
      <CommandHeader workspace={workspace} alertCount={radarAlerts.filter((a) => a.priority === 'HIGH').length} />
      <ActivityTicker />
      <RadarFeed alerts={radarAlerts} onReview={onReviewAlert} workspace={workspace} />
      <DecisionModules onStartFlow={onStartFlow} workspace={workspace} />
      <MemoryStrip sessions={sessions} workspace={workspace} />
    </div>
  );
}

// ── Header (the outcome banner) ──────────────────────────────
function CommandHeader({ workspace, alertCount }) {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <header style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
        <div>
          <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icons.Radar style={{ fontSize: 13, color: 'var(--c-gold)' }} />
            Command Hub · {workspace.name}
          </div>
          <h1 className="font-display" style={{ fontWeight: 700, fontSize: 38, letterSpacing: '-0.03em', margin: 0, color: 'var(--c-text-base)', lineHeight: 1.1 }}>
            {greeting}, Omar.
          </h1>
          <p style={{ marginTop: 10, fontSize: 16, color: 'var(--c-text-soft)', maxWidth: 560, lineHeight: 1.5 }}>
            {alertCount > 0 ? (
              <>
                Lumi flagged <strong style={{ color: 'var(--c-kill-text)' }}>{alertCount} bleeding {alertCount === 1 ? 'campaign' : 'campaigns'}</strong> overnight.
                One verdict is locked and waiting for your sign-off.
              </>
            ) : (
              <>All ad sets nominal. Nothing burning, nothing to sign off on.</>
            )}
          </p>
        </div>

        {/* Health ring */}
        <div style={{ display: 'flex', gap: 24 }}>
          <HealthBlock label="Active ad sets" value="14" tone="neutral" />
          <HealthBlock label="Bleeding" value="2" tone="danger" sub={workspace.currencySym + ' 880/d'} />
          <HealthBlock label="Scaling" value="3" tone="positive" sub="+18% MoM" />
        </div>
      </div>
    </header>
  );
}

function HealthBlock({ label, value, sub, tone }) {
  const c = tone === 'danger' ? 'var(--c-kill-text)' : tone === 'positive' ? 'var(--c-scale-text)' : 'var(--c-text-base)';
  return (
    <div style={{ minWidth: 100 }}>
      <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 4 }}>{label}</div>
      <div className="font-display tabular-nums" style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em', color: c, lineHeight: 1 }}>{value}</div>
      {sub && <div className="font-mono tabular-nums" style={{ fontSize: 11, color: 'var(--c-text-subtle)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ── Activity ticker (live system pulse) ──────────────────────
function ActivityTicker() {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2500);
    return () => clearInterval(id);
  }, []);

  const rows = window.DEMO_DATA.ACTIVITY;
  const visible = rows.slice(0, (tick % rows.length) + 1).reverse();

  const typeIcon = {
    scan:    { Icon: Icons.Radar,   color: 'var(--c-gold)'   },
    alert:   { Icon: Icons.AlertTriangle, color: 'var(--c-kill)' },
    memory:  { Icon: Icons.Database, color: 'var(--c-stage-testing)' },
    verdict: { Icon: Icons.Zap,     color: 'var(--c-text-base)' },
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 16px',
        border: '1px solid var(--c-surface-border)',
        borderRadius: 999,
        background: 'var(--c-surface-card)',
        marginBottom: 24,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 14, borderRight: '1px solid var(--c-surface-border)' }}>
        <GlowDot color="var(--c-gold)" size={6} />
        <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>
          LIVE
        </span>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative', minHeight: 20 }}>
        {visible.map((r, i) => {
          const cfg = typeIcon[r.type] || typeIcon.scan;
          return (
            <div
              key={`${tick}-${r.t}-${i}`}
              className="anim-fade-in"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                position: i === 0 ? 'relative' : 'absolute',
                top: i === 0 ? 0 : -100,
                opacity: i === 0 ? 1 : 0,
              }}
            >
              <cfg.Icon style={{ fontSize: 12, color: cfg.color }} />
              <span className="font-mono" style={{ color: 'var(--c-text-subtle)' }}>{r.t}</span>
              <span style={{ color: 'var(--c-text-soft)' }}>{r.body}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Radar Feed — the proactive alerts
// ══════════════════════════════════════════════════════════════
function RadarFeed({ alerts, onReview, workspace }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <SectionLabel
        accent
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>
              <span className="anim-blink" style={{ color: 'var(--c-kill)' }}>●</span> {alerts.filter((a) => a.priority === 'HIGH').length} HIGH
            </span>
            <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>{alerts.length} total · scanned 14 vectors</span>
          </div>
        }
      >
        Active Radar
      </SectionLabel>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14 }}>
        {alerts.map((a, i) => (
          <RadarCard key={a.id} alert={a} onReview={() => onReview(a)} delay={i * 80} workspace={workspace} />
        ))}
      </div>
    </section>
  );
}

function RadarCard({ alert, onReview, delay, workspace }) {
  const verdictColor = alert.verdict === 'KILL' ? 'var(--c-kill)' : alert.verdict === 'SCALE' ? 'var(--c-scale)' : 'var(--c-hold)';
  const isHigh = alert.priority === 'HIGH';

  return (
    <button
      onClick={onReview}
      className="anim-slide-up"
      style={{
        animationDelay: `${delay}ms`,
        background: 'var(--c-surface-card)',
        border: '1px solid var(--c-surface-border)',
        borderLeft: `3px solid ${verdictColor}`,
        borderRadius: 14,
        padding: '16px 18px',
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'all 200ms',
        boxShadow: isHigh ? '0 4px 16px rgba(239,68,68,0.06)' : 'var(--sh-card)',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = verdictColor;
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = 'var(--sh-card-hover)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--c-surface-border)';
        e.currentTarget.style.borderLeft = `3px solid ${verdictColor}`;
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = isHigh ? '0 4px 16px rgba(239,68,68,0.06)' : 'var(--sh-card)';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PriorityPill priority={alert.priority} />
          <StagePill stage={alert.stage} />
        </div>
        <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-subtle)' }}>{alert.time}</span>
      </div>

      <div className="font-display" style={{ fontWeight: 600, fontSize: 15, color: 'var(--c-text-base)', marginBottom: 4, letterSpacing: '-0.01em' }}>
        {alert.campaign}
      </div>
      <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 12 }}>
        {alert.adset}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', background: 'var(--c-surface-elevated)', borderRadius: 8, marginBottom: 12 }}>
        <Icons.AlertCircle style={{ fontSize: 14, color: verdictColor, marginTop: 1 }} />
        <div>
          <div className="font-display" style={{ fontWeight: 600, fontSize: 12, color: 'var(--c-text-base)' }}>{alert.signal}</div>
          <div style={{ fontSize: 12, color: 'var(--c-text-soft)', marginTop: 2 }}>{alert.detail}</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          {alert.bleed !== '—' ? (
            <>
              <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Bleeding
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: 16, fontWeight: 700, color: 'var(--c-kill-text)' }}>{alert.bleed}</div>
            </>
          ) : (
            <>
              <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {alert.verdict === 'SCALE' ? 'Opportunity' : 'Status'}
              </div>
              <div className="font-mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-base)' }}>
                {alert.verdict === 'SCALE' ? 'Ready to lift' : 'Monitoring'}
              </div>
            </>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <VerdictPill verdict={alert.verdict} />
          <Icons.ArrowRight style={{ fontSize: 14, color: 'var(--c-text-muted)' }} />
        </div>
      </div>
    </button>
  );
}

// ══════════════════════════════════════════════════════════════
// Decision Modules — the manual upload entry points
// ══════════════════════════════════════════════════════════════
function DecisionModules({ onStartFlow, workspace }) {
  const modules = [
    {
      mode: 'campaign',
      badge: 'MODULE 01',
      title: 'Campaign Intelligence',
      body: 'Drop a CSV from Meta Ads Manager or push a fresh API pull. Lumi returns a verdict — KILL / HOLD / SCALE — with financial impact in ~18s.',
      cta: 'Run intelligence scan',
      meta: '~18s · verdict locked · audit trail',
      Icon: Icons.BarChart,
      iconColor: 'var(--c-kill)',
      iconBg: 'var(--c-kill-bg)',
      enabled: true,
      hero: true,
    },
    {
      mode: 'strategy',
      badge: 'MODULE 02',
      title: 'Strategic Intelligence',
      body: 'CMO memory layer. Briefs grounded in your last 90 days of decisions. Phase 2.',
      cta: 'Start session',
      Icon: Icons.Target,
      iconColor: 'var(--c-stage-scaling)',
      iconBg: 'rgba(6,182,212,0.10)',
      enabled: false,
    },
    {
      mode: 'content',
      badge: 'MODULE 03',
      title: 'Content Intelligence',
      body: 'Score ad copy with the 10-step MARCOM framework. Phase 3.',
      cta: 'Submit content',
      Icon: Icons.ScanSearch,
      iconColor: 'var(--c-hold)',
      iconBg: 'var(--c-hold-bg)',
      enabled: false,
    },
  ];

  return (
    <section style={{ marginBottom: 36 }}>
      <SectionLabel right={<span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>3 modules · 1 active</span>}>
        Decision Modules
      </SectionLabel>

      <ModuleCard cfg={modules[0]} onStartFlow={onStartFlow} workspace={workspace} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
        {modules.slice(1).map((m) => (
          <ModuleCard key={m.mode} cfg={m} onStartFlow={onStartFlow} workspace={workspace} />
        ))}
      </div>
    </section>
  );
}

function ModuleCard({ cfg, onStartFlow, workspace }) {
  const disabled = !cfg.enabled;
  const click = () => cfg.enabled && onStartFlow(cfg.mode);

  if (cfg.hero) {
    return (
      <button
        onClick={click}
        disabled={disabled}
        style={{
          width: '100%',
          display: 'flex',
          background: 'var(--c-surface-card)',
          border: '1px solid rgba(246,201,69,0.3)',
          borderRadius: 18,
          padding: 0,
          overflow: 'hidden',
          textAlign: 'left',
          cursor: 'pointer',
          boxShadow: 'var(--sh-gold-glow)',
          transition: 'all 200ms',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(246,201,69,0.6)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(246,201,69,0.3)'; e.currentTarget.style.transform = 'translateY(0)'; }}
      >
        <div style={{ flex: 1, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <span className="font-mono" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', padding: '4px 8px', borderRadius: 4, background: cfg.iconBg, color: cfg.iconColor }}>
              {cfg.badge}
            </span>
            <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>{cfg.meta}</span>
          </div>

          <div
            style={{
              width: 48, height: 48, borderRadius: 12,
              background: cfg.iconBg, color: cfg.iconColor,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 18,
            }}
          >
            <cfg.Icon style={{ fontSize: 26 }} />
          </div>

          <h3 className="font-display" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--c-text-base)', margin: '0 0 8px' }}>
            {cfg.title}
          </h3>
          <p style={{ fontSize: 14, color: 'var(--c-text-soft)', margin: 0, maxWidth: 560, lineHeight: 1.5 }}>
            {cfg.body}
          </p>

          <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="btn-gold">
              <Icons.Upload style={{ fontSize: 14 }} />
              {cfg.cta}
              <Icons.ArrowRight style={{ fontSize: 14 }} />
            </span>
            <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>
              Drop CSV → verdict in ~18s
            </span>
          </div>
        </div>

        {/* Right rail: live feed metrics */}
        <div
          style={{
            width: 220,
            background: 'linear-gradient(180deg, rgba(246,201,69,0.05), rgba(246,201,69,0.02))',
            borderLeft: '1px solid rgba(246,201,69,0.2)',
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 16,
          }}
        >
          <div className="font-mono" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>
            Live feed
          </div>
          <FeedMetric label="Campaigns tracked" value="14" />
          <FeedMetric label={`Spend in feed`} value={workspace.spendTier.split(' ').slice(0, 2).join(' ')} />
          <FeedMetric label="Avg verdict time" value="18s" sub="median" />
          <FeedMetric label="Decisions / wk" value="9" />
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={click}
      disabled={disabled}
      style={{
        background: 'var(--c-surface-card)',
        border: '1px solid var(--c-surface-border)',
        borderRadius: 16,
        padding: 20,
        textAlign: 'left',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        boxShadow: 'var(--sh-card)',
        transition: 'all 180ms',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span className="font-mono" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', padding: '3px 8px', borderRadius: 4, background: cfg.iconBg, color: cfg.iconColor }}>
          {cfg.badge}
        </span>
        {disabled && <Icons.Lock style={{ fontSize: 12, color: 'var(--c-text-subtle)' }} />}
      </div>

      <div
        style={{
          width: 40, height: 40, borderRadius: 10,
          background: cfg.iconBg, color: cfg.iconColor,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 14,
        }}
      >
        <cfg.Icon style={{ fontSize: 22 }} />
      </div>

      <h3 className="font-display" style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--c-text-base)', margin: '0 0 4px' }}>
        {cfg.title}
      </h3>
      <p style={{ fontSize: 13, color: 'var(--c-text-soft)', margin: 0, lineHeight: 1.5 }}>{cfg.body}</p>
    </button>
  );
}

function FeedMetric({ label, value, sub }) {
  return (
    <div>
      <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)' }}>{label}</div>
      <div className="font-display tabular-nums" style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-text-base)' }}>
        {value}
        {sub && <span className="font-mono" style={{ fontSize: 10, fontWeight: 400, color: 'var(--c-text-subtle)', marginLeft: 4 }}>({sub})</span>}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Memory Strip — recent decisions w/ ROAS delta
// ══════════════════════════════════════════════════════════════
function MemoryStrip({ sessions, workspace }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <SectionLabel right={<button className="btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }}><Icons.History style={{ fontSize: 12 }} /> View all decisions</button>}>
        Decision Memory · Last 7 days
      </SectionLabel>

      <div
        style={{
          background: 'var(--c-surface-card)',
          border: '1px solid var(--c-surface-border)',
          borderRadius: 16,
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '12px 18px', background: 'var(--c-surface-elevated)', borderBottom: '1px solid var(--c-surface-border)', display: 'grid', gridTemplateColumns: '120px 1fr 180px 130px 80px', gap: 16 }}>
          <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>Verdict</span>
          <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>Campaign</span>
          <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>Impact</span>
          <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>ROAS Δ (7d)</span>
          <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)', textAlign: 'right' }}>When</span>
        </div>
        {sessions.map((s) => (
          <div
            key={s.id}
            style={{
              padding: '14px 18px',
              borderBottom: '1px solid var(--c-surface-border)',
              display: 'grid',
              gridTemplateColumns: '120px 1fr 180px 130px 80px',
              gap: 16,
              alignItems: 'center',
              cursor: 'pointer',
              transition: 'background 120ms',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--c-surface-elevated)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <VerdictPill verdict={s.verdict} />
            <span className="font-display" style={{ fontWeight: 500, fontSize: 14, color: 'var(--c-text-base)' }}>{s.label}</span>
            <span className="font-mono tabular-nums" style={{ fontSize: 12, color: 'var(--c-text-soft)' }}>{s.impact}</span>
            <span className="font-mono tabular-nums" style={{ fontSize: 12, fontWeight: 600, color: s.delta.startsWith('+') ? 'var(--c-scale-text)' : 'var(--c-text-muted)' }}>
              {s.delta !== '—' && <Icons.TrendingUp style={{ fontSize: 11, marginRight: 4, verticalAlign: 'middle' }} />}
              {s.delta}
            </span>
            <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)', textAlign: 'right' }}>{s.ts}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

Object.assign(window, { CommandHub });

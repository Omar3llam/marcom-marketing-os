// ============================================================
// MARCOM Demo — Success View (the Verdict)
// ------------------------------------------------------------
// Editorial reveal. Big typography, financial impact pinned,
// reasoning bullets, evidence trail, one-tap execute.
// ============================================================

const VERDICT_VISUALS = {
  KILL:  { color: 'var(--c-kill-text)', glow: 'var(--sh-kill-glow)', bg: 'var(--c-kill-bg)',  Icon: Icons.Skull,        verb: 'Stop' },
  HOLD:  { color: 'var(--c-hold-text)', glow: 'var(--sh-hold-glow)', bg: 'var(--c-hold-bg)',  Icon: Icons.Pause2,       verb: 'Hold' },
  SCALE: { color: 'var(--c-scale-text)',glow: 'var(--sh-scale-glow)',bg: 'var(--c-scale-bg)', Icon: Icons.Rocket,       verb: 'Scale' },
  TEST:  { color: 'var(--c-hold-text)', glow: 'var(--sh-hold-glow)', bg: 'var(--c-hold-bg)',  Icon: Icons.ScanSearch,   verb: 'Test' },
};

function SuccessView({ workspace, featured, verdictStyle = 'editorial', onExecute, onCancel, onBackToHub }) {
  const c = featured.campaign;
  const vis = VERDICT_VISUALS[c.verdict];

  return (
    <div data-screen-label="Verdict Reveal" style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 32px 40px' }}>
      <Breadcrumb crumbs={[
        { label: 'Command Hub', onClick: onBackToHub },
        { label: 'Campaign Intelligence', onClick: onCancel },
        { label: 'Verdict', active: true },
      ]} />

      {/* ── Hero verdict band ──────────────────────────────── */}
      {verdictStyle === 'editorial' ? (
        <EditorialVerdict campaign={c} vis={vis} />
      ) : (
        <CardVerdict campaign={c} vis={vis} />
      )}

      {/* ── Reasoning + evidence + action ──────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 18, marginTop: 24 }}>
        {/* LEFT: Reasoning */}
        <div>
          <SectionLabel
            accent
            right={<span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>4 signals · cross-checked w/ memory</span>}
          >
            Why Lumi reached this verdict
          </SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {c.reasoning.map((r, i) => (
              <ReasoningRow key={r.tag} r={r} delay={i * 90} />
            ))}
          </div>

          {/* Metrics row */}
          <div style={{ marginTop: 20 }}>
            <SectionLabel>Campaign metrics · last 14 days</SectionLabel>
            <div
              style={{
                background: 'var(--c-surface-card)',
                border: '1px solid var(--c-surface-border)',
                borderRadius: 14,
                padding: 18,
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 18,
              }}
            >
              <BigMetric
                label="CPA"
                value={c.cpa}
                target={`Target: ${c.cpaTarget}`}
                delta={c.cpaDelta}
                trend="down"
                bad
              />
              <BigMetric
                label="ROAS"
                value={c.roas}
                target={c.roasTarget !== '—' ? `Target: ${c.roasTarget}` : 'Lead gen (no ROAS)'}
                trend="down"
                bad={c.roas !== '—'}
              />
              <BigMetric
                label="Frequency"
                value={c.frequency}
                target="Cold-audience ceiling: 3.5"
                trend="up"
                bad
              />
            </div>
          </div>
        </div>

        {/* RIGHT: Action panel */}
        <div>
          <SectionLabel
            accent
            right={<VerdictPill verdict={c.verdict} />}
          >
            Recommended action
          </SectionLabel>

          <div
            style={{
              background: 'var(--c-surface-card)',
              border: `1px solid ${vis.color}40`,
              borderRadius: 16,
              overflow: 'hidden',
              boxShadow: vis.glow,
            }}
          >
            <div style={{ padding: 20, borderBottom: '1px solid var(--c-surface-border)' }}>
              <div className="font-display" style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--c-text-base)', marginBottom: 6 }}>
                {c.action.title}
              </div>
              <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>
                {c.action.target}
              </div>
            </div>

            <div style={{ padding: '0 20px' }}>
              <ActionRow label="Budget reallocation" value={c.action.budgetMove} Icon={Icons.ArrowUpRight} />
              <ActionRow label="Confidence" value={c.action.confidence} Icon={Icons.Brain} />
              <ActionRow label="Evidence" value={c.action.evidence} Icon={Icons.Database} last />
            </div>

            <div style={{ padding: 18, background: 'var(--c-surface-elevated)' }}>
              <button
                onClick={onExecute}
                className="btn-gold"
                style={{ width: '100%', justifyContent: 'center', padding: '14px 20px', fontSize: 15 }}
              >
                <Icons.Zap style={{ fontSize: 16 }} />
                Execute via Meta API
                <Icons.ArrowRight style={{ fontSize: 16 }} />
              </button>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 10, fontSize: 11 }} className="font-mono">
                <span style={{ color: 'var(--c-text-subtle)' }}>4-layer guard · idempotent · BullMQ</span>
              </div>
            </div>
          </div>

          {/* Override panel */}
          <div style={{ marginTop: 14, padding: 14, background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 12 }}>
            <div className="section-label" style={{ marginBottom: 8 }}>Override</div>
            <p style={{ fontSize: 12, color: 'var(--c-text-soft)', margin: '0 0 12px' }}>
              Disagree with the verdict? Lumi logs every override and revisits the heuristic.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-ghost" style={{ flex: 1, justifyContent: 'center', fontSize: 12 }}>Mark as HOLD</button>
              <button className="btn-ghost" style={{ flex: 1, justifyContent: 'center', fontSize: 12 }}>Reject verdict</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Variant A — Editorial (Bold typography, magazine layout)
// ══════════════════════════════════════════════════════════════
function EditorialVerdict({ campaign, vis }) {
  const c = campaign;
  return (
    <section
      className="anim-verdict-enter"
      style={{
        background: 'var(--c-surface-card)',
        border: '1px solid var(--c-surface-border)',
        borderRadius: 22,
        padding: 36,
        overflow: 'hidden',
        position: 'relative',
        boxShadow: 'var(--sh-card)',
      }}
    >
      {/* Top tag row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-gold-deep)' }}>
            Verdict locked · {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </span>
          <span style={{ color: 'var(--c-text-subtle)' }}>·</span>
          <StagePill stage={c.stage} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <ConfidenceMeter pct={c.confidence} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 36, alignItems: 'center' }}>
        {/* LEFT: The verdict + headline */}
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, marginBottom: 12 }}>
            <vis.Icon style={{ fontSize: 64, color: vis.color }} />
            <h1
              className="font-display tabular-nums"
              style={{
                fontSize: 120,
                fontWeight: 800,
                letterSpacing: '-0.06em',
                lineHeight: 0.85,
                margin: 0,
                color: vis.color,
              }}
            >
              {c.verdict}
            </h1>
          </div>
          <h2 className="font-display" style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.2, margin: '8px 0 6px', color: 'var(--c-text-base)' }}>
            {c.title}
          </h2>
          <p style={{ fontSize: 14, color: 'var(--c-text-soft)', margin: 0, maxWidth: 480, lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--c-text-base)' }}>{c.name}</strong> · {c.audience} · {c.daysRun} days · {c.spend} spent
          </p>
        </div>

        {/* RIGHT: Financial impact */}
        <div style={{ borderLeft: `2px solid ${vis.color}40`, paddingLeft: 28 }}>
          <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 8 }}>
            Financial impact
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: 42, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--c-text-base)', lineHeight: 1 }}>
            {c.financialImpact.value}
          </div>
          <div className="font-mono" style={{ fontSize: 13, color: 'var(--c-text-muted)', marginTop: 4 }}>
            {c.financialImpact.cadence}
          </div>
          <div style={{ fontSize: 13, color: vis.color, marginTop: 10, fontWeight: 600 }} className="font-display">
            {c.financialImpact.sub}
          </div>
          <div
            style={{
              marginTop: 16,
              padding: '10px 12px',
              background: vis.bg,
              borderRadius: 10,
              fontSize: 12,
              color: 'var(--c-text-base)',
            }}
          >
            <span className="font-display" style={{ fontWeight: 600 }}>Monthly projection:</span>{' '}
            <span className="font-mono tabular-nums">{c.monthlyProj}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════════════════════
// Variant B — Composed Card (restrained)
// ══════════════════════════════════════════════════════════════
function CardVerdict({ campaign, vis }) {
  const c = campaign;
  return (
    <section
      className="anim-verdict-enter"
      style={{
        background: 'var(--c-surface-card)',
        border: `1px solid ${vis.color}30`,
        borderRadius: 18,
        padding: 28,
        boxShadow: vis.glow,
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 28, alignItems: 'center' }}>
        <div>
          <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 10 }}>
            Verdict
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <vis.Icon style={{ fontSize: 36, color: vis.color }} />
            <span className="font-display" style={{ fontSize: 56, fontWeight: 700, letterSpacing: '-0.04em', color: vis.color, lineHeight: 1 }}>
              {c.verdict}
            </span>
          </div>
          <div style={{ marginTop: 12, fontSize: 14, color: 'var(--c-text-soft)' }}>
            {c.title}
          </div>
        </div>

        <div>
          <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 10 }}>
            Financial impact
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: 32, fontWeight: 700, color: 'var(--c-text-base)' }}>
            {c.financialImpact.value}
          </div>
          <div className="font-mono" style={{ fontSize: 12, color: 'var(--c-text-muted)', marginTop: 4 }}>
            {c.financialImpact.cadence} · {c.financialImpact.sub}
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: 13, color: vis.color, marginTop: 8, fontWeight: 600 }}>
            {c.monthlyProj}
          </div>
        </div>

        <div>
          <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 10 }}>
            Confidence
          </div>
          <ConfidenceMeter pct={c.confidence} large />
        </div>
      </div>
    </section>
  );
}

// ── Confidence meter ─────────────────────────────────────────
function ConfidenceMeter({ pct, large = false }) {
  return (
    <div style={{ width: large ? '100%' : 200 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>
          Confidence
        </span>
        <span className="font-mono tabular-nums" style={{ fontSize: large ? 24 : 13, fontWeight: 700, color: 'var(--c-text-base)' }}>
          {pct}%
        </span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: 'var(--c-surface-border)', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: 'linear-gradient(90deg, var(--c-gold-deep), var(--c-gold))',
            animation: 'confidence-fill 700ms cubic-bezier(0.16,1,0.3,1) 300ms both',
          }}
        />
      </div>
    </div>
  );
}

function ReasoningRow({ r, delay }) {
  return (
    <div
      className="anim-slide-up"
      style={{
        animationDelay: `${delay}ms`,
        padding: '14px 16px',
        background: 'var(--c-surface-card)',
        border: '1px solid var(--c-surface-border)',
        borderRadius: 12,
        display: 'grid',
        gridTemplateColumns: '110px 1fr',
        gap: 16,
        alignItems: 'center',
      }}
    >
      <span
        className="font-mono"
        style={{
          fontSize: 10,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--c-gold-deep)',
          background: 'rgba(246,201,69,0.08)',
          padding: '4px 8px',
          borderRadius: 4,
          textAlign: 'center',
        }}
      >
        {r.tag}
      </span>
      <span style={{ fontSize: 13, color: 'var(--c-text-soft)', lineHeight: 1.5 }}>{r.body}</span>
    </div>
  );
}

function BigMetric({ label, value, target, delta, trend, bad }) {
  const arrow = trend === 'up' ? <Icons.TrendingUp style={{ fontSize: 14, color: bad ? 'var(--c-kill)' : 'var(--c-scale)' }} /> :
                 trend === 'down' ? <Icons.TrendingDown style={{ fontSize: 14, color: bad ? 'var(--c-kill)' : 'var(--c-scale)' }} /> : null;
  return (
    <div>
      <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="font-mono tabular-nums" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: bad ? 'var(--c-kill-text)' : 'var(--c-text-base)' }}>
          {value}
        </span>
        {delta && <span className="font-mono tabular-nums" style={{ fontSize: 12, fontWeight: 600, color: bad ? 'var(--c-kill-text)' : 'var(--c-scale-text)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>{arrow} {delta}</span>}
      </div>
      <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-subtle)', marginTop: 4 }}>{target}</div>
    </div>
  );
}

function ActionRow({ label, value, Icon, last }) {
  return (
    <div
      style={{
        padding: '14px 0',
        borderBottom: last ? 'none' : '1px solid var(--c-surface-border)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Icon style={{ fontSize: 14, color: 'var(--c-text-muted)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</div>
        <div className="font-display" style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text-base)', marginTop: 2 }}>{value}</div>
      </div>
    </div>
  );
}

window.SuccessView = SuccessView;

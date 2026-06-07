// ============================================================
// Lumi — Plan page (Phase 6: the Planning OS)
// ============================================================
// "Plan next quarter — powered by what Lumi has learned." The forward-
// looking surface, and deliberately NOT a generic planning dashboard:
//   • Scenario / what-if (Reallocate · Expand · Contract): CAC, volume,
//     revenue, AND gross profit as BANDS (low–expected–high) + named
//     assumptions — never a single number; expansion shows "CAC worse /
//     profit better";
//   • North-star: target + a trend-based landing ESTIMATE (a range, never
//     a guarantee) + a leading-indicator line that can flag risk before
//     CAC breaks;
//   • Unit economics: LTV / payback / contribution + LTV:CAC band — is the
//     current CAC sustainable?
//   • The plan: budget + channel mix + testing agenda, a memoryBasis strip
//     ("Powered by Decision Memory"), and a Promote-mix action that routes
//     to confirm (Phase-3 governance, never silent).
// ============================================================

import { Icons } from './icons.jsx';
import { DEMO_DATA } from './data.js';
import { VerdictPill, formatCurrency } from './primitives.jsx';

const STATUS_COLOR = {
  ON_TRACK:  { fg: 'var(--c-ok-deep, #1f8a4c)',  bg: 'var(--c-ok-soft, rgba(34,160,90,0.12))' },
  AT_RISK:   { fg: 'var(--c-warn-deep, #9a6a10)', bg: 'var(--c-warn-soft, rgba(200,140,20,0.10))' },
  OFF_TRACK: { fg: 'var(--c-bad-deep, #b3261e)',  bg: 'var(--c-bad-soft, rgba(200,40,30,0.10))' },
};
const BAND_COLOR = {
  HEALTHY:    'var(--c-ok-deep, #1f8a4c)',
  THIN:       'var(--c-warn-deep, #9a6a10)',
  UNDERWATER: 'var(--c-bad-deep, #b3261e)',
};

function Card({ title, sub, children, accent }) {
  return (
    <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, padding: 18, boxShadow: 'var(--sh-card)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14 }}>
        <h2 className="font-display" style={{ fontSize: 17, fontWeight: 700, margin: 0, color: 'var(--c-text-base)' }}>{title}</h2>
        {accent}
        {sub && <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c-text-muted)' }}>{sub}</span>}
      </div>
      {children}
    </div>
  );
}

function StatusBadge({ status }) {
  const c = STATUS_COLOR[status] ?? STATUS_COLOR.ON_TRACK;
  return (
    <span className="font-mono" style={{
      fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 5,
      background: c.bg, color: c.fg, border: `1px solid ${c.fg}33`,
    }}>{(status ?? '').replace('_', ' ')}</span>
  );
}

// The honesty primitive: a labelled low–expected–high band. NEVER a point.
function RangeBand({ range, format, higherIsWorse }) {
  const f = format ?? ((v) => v);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-text-base)' }}>{f(range.expected)}</span>
        <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>expected</span>
      </div>
      <div className="font-mono" style={{ fontSize: 12, color: 'var(--c-text-muted)', marginTop: 2 }}>
        range {f(higherIsWorse ? range.low : range.low)} – {f(range.high)}
      </div>
    </div>
  );
}

function Metric({ label, children }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--c-surface-elevated)' }}>
      <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function Assumptions({ items }) {
  return (
    <ul style={{ margin: '12px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
      {items.map((a, i) => (
        <li key={i} style={{ display: 'flex', gap: 7, fontSize: 12, color: 'var(--c-text-muted)', lineHeight: 1.4 }}>
          <span style={{ color: 'var(--c-text-muted)', flexShrink: 0 }}>•</span>{a}
        </li>
      ))}
    </ul>
  );
}

// ── Scenario / what-if ───────────────────────────────────────
function ScenarioCard({ scenarios, currency }) {
  const keys = Object.keys(scenarios);
  const [active, setActive] = React.useState(keys[0]);
  const s = scenarios[active];
  const money = (v) => formatCurrency(Math.round(v), currency);
  const num   = (v) => Math.round(v).toLocaleString('en-US');
  const ratio = (v) => `${(v ?? 0).toFixed(2)}x`;
  const profitBetter = /profit better/i.test(s.basis);

  return (
    <Card title="Scenario / what-if"
      accent={<span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>· ranges, not guesses</span>}
      sub={`${Math.round(s.confidence * 100)}% confidence`}>
      {/* Scenario-type toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {keys.map((k) => (
          <button key={k} type="button" onClick={() => setActive(k)}
            className="font-mono"
            style={{
              fontSize: 11, padding: '6px 11px', borderRadius: 7, cursor: 'pointer',
              border: `1px solid ${active === k ? 'var(--c-accent, #C99A3B)' : 'var(--c-surface-border)'}`,
              background: active === k ? 'var(--c-accent-soft, rgba(201,154,59,0.12))' : 'var(--c-surface-elevated)',
              color: active === k ? 'var(--c-text-base)' : 'var(--c-text-muted)',
            }}>{scenarios[k].label}</button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <Metric label="Blended CAC"><RangeBand range={s.projections.blendedCacMinor} format={money} higherIsWorse /></Metric>
        <Metric label="Volume (orders)"><RangeBand range={s.projections.volume} format={num} /></Metric>
        <Metric label="Revenue"><RangeBand range={s.projections.revenueMinor} format={money} /></Metric>
        <Metric label="Gross profit"><RangeBand range={s.projections.grossProfitMinor} format={money} /></Metric>
      </div>

      {profitBetter && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, padding: '10px 12px', borderRadius: 10, background: 'var(--c-ok-soft, rgba(34,160,90,0.10))', border: '1px solid var(--c-ok-deep, #1f8a4c)22' }}>
          <Icons.TrendingUp style={{ fontSize: 16, color: 'var(--c-ok-deep, #1f8a4c)', flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
          <span style={{ fontSize: 13, color: 'var(--c-text-base)' }}>
            <strong>CAC worse, profit better.</strong> Added budget buys less efficient orders, but total gross profit still grows — the trade a strategist would take.
          </span>
        </div>
      )}

      <Assumptions items={s.assumptions} />
    </Card>
  );
}

// ── North-star ───────────────────────────────────────────────
function NorthStarCard({ goal, currency }) {
  const money = (v) => formatCurrency(Math.round(v), currency);
  const pct = Math.round((goal.pctOfPeriodElapsed ?? 0) * 100);
  return (
    <Card title="North-star" accent={<StatusBadge status={goal.status} />} sub={`${pct}% of period elapsed`}>
      <p style={{ fontSize: 14, color: 'var(--c-text-base)', margin: '0 0 12px', fontWeight: 600 }}>{goal.name}</p>

      <Metric label="Trend-based landing estimate">
        <RangeBand range={goal.trendBasedLandingEstimate} format={money} higherIsWorse />
        <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 6 }}>
          target {goal.comparator === 'LTE' || goal.comparator === 'LT' ? '≤' : '≥'} {money(goal.targetValueMinor)} · estimate, not a guarantee
        </div>
      </Metric>

      {/* Progress bar */}
      <div style={{ height: 7, borderRadius: 4, background: 'var(--c-surface-elevated)', marginTop: 14, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: STATUS_COLOR[goal.status]?.fg ?? 'var(--c-accent, #C99A3B)' }} />
      </div>

      {goal.leadingSignal && goal.laggingStatus === 'ON_TRACK' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14, padding: '10px 12px', borderRadius: 10, background: STATUS_COLOR.AT_RISK.bg, border: `1px solid ${STATUS_COLOR.AT_RISK.fg}22` }}>
          <Icons.Activity style={{ fontSize: 16, color: STATUS_COLOR.AT_RISK.fg, flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
          <span style={{ fontSize: 13, color: 'var(--c-text-base)' }}>
            On track on CAC — but <strong>{goal.leadingSignal.signal.replace('_', ' ')}</strong> on {goal.leadingSignal.entity} projects a miss in ~{goal.leadingSignal.daysToBreach} days. Leading signals warn before the headline breaks.
          </span>
        </div>
      )}
    </Card>
  );
}

// ── Unit economics ───────────────────────────────────────────
function EconomicsCard({ economics, currency }) {
  const money = (v) => formatCurrency(Math.round(v), currency);
  const band = economics.sustainabilityBand;
  return (
    <Card title="Unit economics" sub="is current CAC sustainable?">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
        <Metric label="LTV"><span style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-text-base)' }}>{money(economics.ltvMinor)}</span></Metric>
        <Metric label="Contribution / order"><span style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-text-base)' }}>{money(economics.contributionPerOrderMinor)}</span></Metric>
        <Metric label="Payback"><span style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-text-base)' }}>{economics.paybackOrders} order{economics.paybackOrders === 1 ? '' : 's'}</span></Metric>
        <Metric label="LTV : CAC">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: BAND_COLOR[band.expected] ?? 'var(--c-text-base)' }}>{economics.ltvToCac.expected.toFixed(1)}×</span>
            <span className="font-mono" style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, background: 'var(--c-surface-card)', color: BAND_COLOR[band.expected] ?? 'var(--c-text-muted)', border: `1px solid ${BAND_COLOR[band.expected] ?? 'var(--c-surface-border)'}33` }}>{band.expected}</span>
          </div>
          <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 4 }}>
            {economics.ltvToCac.low.toFixed(1)}×–{economics.ltvToCac.high.toFixed(1)}× across the CAC range
          </div>
        </Metric>
      </div>
    </Card>
  );
}

// ── The plan (mix + agenda + memoryBasis + promote) ──────────
function PlanCard({ plan, currency, onNav }) {
  const [promoted, setPromoted] = React.useState(false);
  const money = (v) => formatCurrency(v, currency);
  return (
    <Card title="The plan" sub={`${plan.periodLabel} · ${money(plan.budgetMinor)}`}>
      {/* Channel mix */}
      <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 8 }}>Channel mix</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 16 }}>
        {plan.mix.map((m) => (
          <div key={m.channel} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
            <span style={{ width: 64, color: 'var(--c-text-base)' }}>{m.channel}</span>
            <VerdictPill verdict={m.verdict} />
            <span style={{ marginLeft: 'auto', color: 'var(--c-text-muted)' }}>{money(m.currentSpendMinor)} →</span>
            <span style={{ color: 'var(--c-text-base)', fontWeight: 600, width: 96, textAlign: 'right' }}>{money(m.recommendedSpendMinor)}</span>
            <span className="font-mono" style={{ width: 80, textAlign: 'right', color: m.deltaMinor > 0 ? 'var(--c-ok-deep, #1f8a4c)' : m.deltaMinor < 0 ? 'var(--c-bad-deep, #b3261e)' : 'var(--c-text-muted)' }}>
              {m.deltaMinor > 0 ? '+' : ''}{money(m.deltaMinor)}
            </span>
          </div>
        ))}
      </div>

      {/* Testing agenda (from Phase 4) */}
      <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 8 }}>Testing agenda</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
        {plan.testingAgenda.map((t, i) => (
          <div key={i} style={{ fontSize: 13, color: 'var(--c-text-base)' }}>
            <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', marginRight: 8 }}>{t.dimension}</span>{t.name}
          </div>
        ))}
      </div>

      {/* memoryBasis — "Powered by Memory" */}
      <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 8 }}>Built on what Lumi learned</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 18 }}>
        {plan.memoryBasis.map((p) => (
          <span key={p.patternId} title={p.statement} className="font-mono" style={{
            fontSize: 11, padding: '4px 9px', borderRadius: 6, background: 'var(--c-surface-elevated)',
            color: 'var(--c-text-muted)', border: '1px solid var(--c-surface-border)',
          }}>{p.kind.replace(/_/g, ' ').toLowerCase()} · {Math.round((p.accuracy ?? 0) * 100)}%</span>
        ))}
      </div>

      {promoted ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--c-ok-deep, #1f8a4c)' }}>
          <Icons.Check style={{ fontSize: 15 }} aria-hidden="true" /> Mix promoted — each move is now a REALLOCATE verdict awaiting your confirm (Phase-3 governance).
        </div>
      ) : (
        <button type="button" className="btn-gold" onClick={() => { setPromoted(true); onNav?.('campaigns'); }} style={{ height: 36 }}>
          <Icons.Zap style={{ fontSize: 14 }} aria-hidden="true" /> Promote mix
        </button>
      )}
    </Card>
  );
}

export function PlanPage({ workspace, onNav }) {
  const persona = workspace?.id ?? 'apparel';
  const plan = DEMO_DATA.PLAN_BY_WS?.[persona] ?? DEMO_DATA.PLAN_BY_WS?.apparel ?? null;

  return (
    <div data-screen-label="Plan" style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 32px 48px' }}>
      <header style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>
            Plan · {workspace?.name ?? 'Workspace'}
          </span>
          <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 5, background: 'var(--c-accent-soft, rgba(201,154,59,0.12))', color: 'var(--c-accent, #C99A3B)', border: '1px solid var(--c-accent, #C99A3B)33' }}>
            Powered by Decision Memory
          </span>
        </div>
        <h1 className="font-display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, color: 'var(--c-text-base)' }}>
          Plan next quarter — and watch Lumi hit it.
        </h1>
        <p style={{ fontSize: 14, color: 'var(--c-text-muted)', marginTop: 8, maxWidth: 780 }}>
          Every projection is a <strong style={{ color: 'var(--c-text-base)' }}>range with its assumptions</strong>, grounded in what Lumi has learned about this account — not a single confident number a dashboard would invent.
        </p>
      </header>

      {!plan ? (
        <div style={{ fontSize: 14, color: 'var(--c-text-muted)', padding: '40px 0' }}>
          No plan built yet. Lumi needs a few weeks of decisions + an economics profile before it can project a next-quarter plan honestly.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16, alignItems: 'start' }}>
          <ScenarioCard scenarios={plan.scenarios} currency={plan.currency} />
          <NorthStarCard goal={plan.goal} currency={plan.currency} />
          <EconomicsCard economics={plan.economics} currency={plan.currency} />
          <PlanCard plan={plan} currency={plan.currency} onNav={onNav} />
        </div>
      )}
    </div>
  );
}

// ============================================================
// Lumi — Portfolio page (Phase 3: capital allocation)
// ============================================================
// Cross-channel portfolio view built on BLENDED truth (GA4/Shopify
// actuals reconciled against platform claims). Shows:
//   • blended MER / spend / revenue + the platform-vs-blended gap
//   • per-channel blended-truth rows (RECONCILED vs UNVERIFIED)
//   • pacing bars ("Meta exhausts budget 6 days early")
//   • an allocation recommender: budget + growth-ceiling goal →
//     scenario preview ("blended CPA X→Y") + reasoning → REALLOCATE
//     moves the human confirms (never auto-executed).
// All money is integer minor units; formatted only at render.
// ============================================================

import { Icons } from './icons.jsx';
import { VerdictPill, formatCurrency, formatCurrencyCompact } from './primitives.jsx';
import { DEMO_DATA } from './data.js';

const pctText = (v) => `${(Number(v) || 0) >= 0 ? '' : '−'}${Math.abs((Number(v) || 0) * 100).toFixed(0)}%`;
const roasText = (v) => `${(Number(v) || 0).toFixed(2)}×`;

// Coverage badge — RECONCILED (verified) vs UNVERIFIED (platform claim only).
function CoverageBadge({ coverage }) {
  const reconciled = coverage === 'RECONCILED';
  return (
    <span
      className="font-mono"
      title={reconciled ? 'Reconciled against GA4 / Shopify actuals' : 'No connector yet — raw platform claim, low confidence'}
      style={{
        fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
        padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap',
        background: reconciled ? 'var(--c-ok-soft, rgba(34,160,90,0.12))' : 'var(--c-warn-soft, rgba(200,140,20,0.14))',
        color: reconciled ? 'var(--c-ok-deep, #1f8a4c)' : 'var(--c-warn-deep, #9a6a10)',
        border: `1px solid ${reconciled ? 'var(--c-ok-deep, #1f8a4c)' : 'var(--c-warn-deep, #9a6a10)'}33`,
      }}
    >
      {reconciled ? 'Reconciled' : 'Unverified'}
    </span>
  );
}

// One stat card.
function StatCard({ label, value, sub, tone }) {
  return (
    <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 12, padding: '16px 18px', boxShadow: 'var(--sh-card)' }}>
      <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 8 }}>{label}</div>
      <div className="font-display" style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: tone === 'danger' ? 'var(--c-danger-deep, #c0392b)' : 'var(--c-text-base)' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--c-text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// Pacing bar for one channel/portfolio.
function PacingBar({ label, pacing, currency }) {
  if (!pacing) return null;
  const over = pacing.status === 'OVER';
  const under = pacing.status === 'UNDER';
  const color = over ? 'var(--c-danger-deep, #c0392b)' : under ? 'var(--c-text-muted)' : 'var(--c-ok-deep, #1f8a4c)';
  const pct = Math.min(100, Math.max(6, Math.round((pacing.projectedSpendMinor && pacing.projectedSpendMinor > 0 ? 100 : 60))));
  const msg = over
    ? `exhausts budget ${pacing.daysEarly} day${pacing.daysEarly === 1 ? '' : 's'} early`
    : under
      ? `under-pacing · ${Math.abs(pacing.daysEarly)} day${Math.abs(pacing.daysEarly) === 1 ? '' : 's'} of headroom`
      : 'on track';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
      <div style={{ width: 110, fontSize: 13, fontWeight: 600, color: 'var(--c-text-base)' }}>{label}</div>
      <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--c-surface-elevated)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, opacity: over ? 1 : 0.6 }} />
      </div>
      <div className="font-mono" style={{ width: 240, textAlign: 'right', fontSize: 11, color, whiteSpace: 'nowrap' }}>{msg}</div>
    </div>
  );
}

export function PortfolioPage({ workspace, onNav, onStartFlow }) {
  const persona = workspace?.id ?? 'apparel';
  const data = DEMO_DATA.PORTFOLIO_BY_WS?.[persona] ?? DEMO_DATA.PORTFOLIO_BY_WS.apparel;
  const currency = data.currency;
  const { totals, channels, allocation, monthlyBudgetMinor } = data;

  const [showPlan, setShowPlan] = React.useState(false);
  const [committed, setCommitted] = React.useState(false);
  const [budget, setBudget] = React.useState(Math.round((monthlyBudgetMinor ?? 0) / 10 ** 2)); // major units in the input

  const merDelta = (allocation.projected.merAfter - allocation.projected.merBefore);

  return (
    <div data-screen-label="Portfolio" style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 32px 48px' }}>
      {/* Header */}
      <header style={{ marginBottom: 22 }}>
        <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 8 }}>
          Portfolio · {workspace?.name ?? 'Workspace'}
        </div>
        <h1 className="font-display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, color: 'var(--c-text-base)' }}>
          {roasText(totals.blendedRoas)} blended MER across {channels.length} channels.
        </h1>
        <p style={{ fontSize: 14, color: 'var(--c-text-muted)', marginTop: 8, maxWidth: 720 }}>
          Allocation runs on <strong style={{ color: 'var(--c-text-base)' }}>blended truth</strong> — GA4/Shopify actuals reconciled
          against platform claims — not the platform's own ROAS.
        </p>
      </header>

      {/* Totals */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 28 }}>
        <StatCard label="Blended MER" value={roasText(totals.blendedRoas)} sub={`Platform claims ${roasText(totals.platformRoas)}`} />
        <StatCard label="Spend (MTD)" value={formatCurrencyCompact(totals.spendMinor, currency)} sub="across all channels" />
        <StatCard label="Blended revenue" value={formatCurrencyCompact(totals.blendedRevenueMinor, currency)} sub={`vs ${formatCurrencyCompact(totals.platformRevenueMinor, currency)} claimed`} />
        <StatCard
          label="Platform over-report"
          value={pctText(totals.gapPct)}
          tone={totals.gapPct > 0.1 ? 'danger' : undefined}
          sub={`${totals.reconciledCount} reconciled · ${totals.unverifiedCount} unverified`}
        />
      </div>

      {/* Blended-truth reconciliation */}
      <section style={{ marginBottom: 28 }}>
        <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px', color: 'var(--c-text-base)' }}>Blended truth</h2>
        <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--sh-card)' }}>
          <div className="font-mono" style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr 1fr 0.8fr 110px', gap: 10, padding: '12px 18px', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-text-muted)', borderBottom: '1px solid var(--c-surface-border)' }}>
            <span>Channel</span><span>Spend</span><span>Platform rev</span><span>Actual rev</span><span>Blended ROAS</span><span style={{ textAlign: 'right' }}>Coverage</span>
          </div>
          {channels.map((c) => (
            <div key={c.channelId} style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr 1fr 0.8fr 110px', gap: 10, padding: '14px 18px', alignItems: 'center', borderBottom: '1px solid var(--c-surface-border)' }}>
              <span style={{ fontWeight: 600, color: 'var(--c-text-base)' }}>{c.channel}</span>
              <span style={{ fontSize: 13, color: 'var(--c-text-base)' }}>{formatCurrency(c.spendMinor, currency)}</span>
              <span style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>{formatCurrency(c.platformRevenueMinor, currency)}</span>
              <span style={{ fontSize: 13, color: c.actualRevenueMinor == null ? 'var(--c-text-muted)' : 'var(--c-text-base)' }}>
                {c.actualRevenueMinor == null ? '— no connector' : formatCurrency(c.actualRevenueMinor, currency)}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: c.blendedRoas < 1 ? 'var(--c-danger-deep, #c0392b)' : 'var(--c-text-base)' }}>
                {roasText(c.blendedRoas)}
                {c.gapPct > 0.02 && <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', marginLeft: 6 }}>(−{pctText(c.gapPct).replace('−', '')})</span>}
              </span>
              <span style={{ textAlign: 'right' }}><CoverageBadge coverage={c.coverage} /></span>
            </div>
          ))}
        </div>
      </section>

      {/* Pacing */}
      <section style={{ marginBottom: 28 }}>
        <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px', color: 'var(--c-text-base)' }}>Pacing</h2>
        <div style={{ fontSize: 13, color: 'var(--c-text-muted)', marginBottom: 12 }}>Budget {formatCurrency(monthlyBudgetMinor, currency)} / month.</div>
        <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, padding: '10px 18px', boxShadow: 'var(--sh-card)' }}>
          {channels.map((c) => <PacingBar key={c.channelId} label={c.channel} pacing={c.pacing} currency={currency} />)}
        </div>
      </section>

      {/* Allocation recommender */}
      <section>
        <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px', color: 'var(--c-text-base)' }}>Capital allocation</h2>
        <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, padding: 18, boxShadow: 'var(--sh-card)' }}>
          {/* Controls */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: showPlan ? 18 : 0 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>Monthly budget ({currency})</span>
              <input
                type="number" value={budget} onChange={(e) => setBudget(Number(e.target.value))}
                style={{ width: 160, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--c-surface-border)', background: 'var(--c-surface-elevated)', color: 'var(--c-text-base)', fontSize: 14 }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>Goal</span>
              <div style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--c-surface-border)', background: 'var(--c-surface-elevated)', color: 'var(--c-text-base)', fontSize: 14 }}>Growth ceiling</div>
            </label>
            <button type="button" className="btn-gold" onClick={() => { setShowPlan(true); setCommitted(false); }} style={{ height: 38 }}>
              <Icons.TrendingUp style={{ fontSize: 14 }} aria-hidden="true" />
              {showPlan ? 'Re-run allocation' : 'Recommend allocation'}
            </button>
          </div>

          {showPlan && (
            <div>
              {/* Scenario headline */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 14px', borderRadius: 10, background: 'var(--c-surface-elevated)', marginBottom: 16 }}>
                <Icons.Activity style={{ fontSize: 16, color: 'var(--c-gold-deep)' }} aria-hidden="true" />
                <span style={{ fontSize: 14, color: 'var(--c-text-base)' }}>
                  Accepting these moves: blended MER <strong>{roasText(allocation.projected.merBefore)} → {roasText(allocation.projected.merAfter)}</strong>
                  {' '}({merDelta >= 0 ? '+' : ''}{(merDelta).toFixed(2)}×), projected blended CPA <strong>{formatCurrency(allocation.projected.projectedCpaMinor, currency)}</strong>.
                </span>
              </div>

              {/* Moves */}
              <div style={{ border: '1px solid var(--c-surface-border)', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
                {allocation.allocations.map((a) => {
                  const grow = a.deltaMinor > 0;
                  return (
                    <div key={a.channelId} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 130px 120px', gap: 10, padding: '12px 14px', alignItems: 'center', borderBottom: '1px solid var(--c-surface-border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <VerdictPill verdict={a.verdict} />
                        <span style={{ fontWeight: 600, color: 'var(--c-text-base)' }}>{a.channel}</span>
                      </div>
                      <span className="font-mono" style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{formatCurrencyCompact(a.currentSpendMinor, currency)}</span>
                      <span className="font-mono" style={{ fontSize: 12, color: 'var(--c-text-base)' }}>→ {formatCurrencyCompact(a.recommendedSpendMinor, currency)}</span>
                      <span className="font-mono" style={{ fontSize: 13, fontWeight: 700, textAlign: 'right', color: grow ? 'var(--c-ok-deep, #1f8a4c)' : 'var(--c-danger-deep, #c0392b)' }}>
                        {grow ? '+' : '−'}{formatCurrencyCompact(Math.abs(a.deltaMinor), currency).replace(`${currency} `, '')}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Reasoning trail */}
              <div style={{ marginBottom: 18 }}>
                <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 8 }}>Reasoning</div>
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {allocation.reasoningTrail.map((r, i) => (
                    <li key={i} style={{ fontSize: 13, color: 'var(--c-text-base)', lineHeight: 1.5 }}>{r}</li>
                  ))}
                </ul>
              </div>

              {/* Commit → confirm (never auto-executes) */}
              {committed ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--c-ok-deep, #1f8a4c)' }}>
                  <Icons.Check style={{ fontSize: 15 }} aria-hidden="true" />
                  {allocation.allocations.length} REALLOCATE moves queued as proposals — each still needs your confirm before execution.
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <button type="button" className="btn-gold" onClick={() => setCommitted(true)}>
                    <Icons.Check style={{ fontSize: 14 }} aria-hidden="true" />
                    Propose {allocation.allocations.length} moves
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>Moves route to confirm → execute governance. Lumi never auto-spends.</span>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

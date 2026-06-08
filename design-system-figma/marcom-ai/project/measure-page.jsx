// ============================================================
// Lumi — Measure page (Phase 7: the Measurement OS)
// ============================================================
// "Was it real? — measurement you can defend." The honesty layer, gated to
// Agency/Enterprise. THE GUARD made visible: every number carries a SOURCE
// chip + a CONFIDENCE dot; nothing is ever a bare attributed figure.
//   • Reconciliation: platform-reported vs blended-truth vs incrementality-
//     adjusted, side by side, with the gaps explicit.
//   • Attribution: last-click + causal populated; path models honestly DARK
//     (no journey data) — never faked. The causal model is labelled
//     "incrementality-weighted · not Google DDA".
//   • Incrementality: a concluded holdout as a LIFT + CONFIDENCE INTERVAL,
//     and an INCONCLUSIVE example that refuses to call it.
//   • Allocation feed: budget now optimizes on incremental, not claimed.
// When tier is NONE, an honest locked state — not the data.
// ============================================================

import { Icons } from './icons.jsx';
import { DEMO_DATA } from './data.js';
import { formatCurrency } from './primitives.jsx';

const SOURCE_LABEL = { PLATFORM: 'platform', BLENDED: 'blended', MODEL: 'model', INCREMENTALITY: 'causal' };
const CONF_COLOR = {
  HIGH:   'var(--c-ok-deep, #1f8a4c)',
  MEDIUM: 'var(--c-warn-deep, #9a6a10)',
  LOW:    'var(--c-text-muted)',
};

function SourceChip({ source }) {
  return (
    <span className="font-mono" style={{
      fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4,
      background: 'var(--c-surface-elevated)', color: 'var(--c-text-muted)', border: '1px solid var(--c-surface-border)',
    }}>{SOURCE_LABEL[source] ?? source}</span>
  );
}

function ConfidenceDot({ confidence }) {
  return (
    <span title={`${confidence} confidence`} style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: CONF_COLOR[confidence] ?? 'var(--c-text-muted)',
    }} />
  );
}

// An Attributed figure: value + source + confidence, never bare.
function AttributedValue({ a, currency, align = 'right' }) {
  if (!a) return <span style={{ color: 'var(--c-text-muted)' }}>—</span>;
  const val = a.value == null
    ? <span title={a.caveat ?? ''} className="font-mono" style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>no causal read</span>
    : <span style={{ fontWeight: 600, color: 'var(--c-text-base)' }}>{formatCurrency(a.value, currency)}</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align === 'right' ? 'flex-end' : 'flex-start', gap: 3 }}>
      {val}
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }} title={a.caveat ?? ''}>
        <SourceChip source={a.source} /><ConfidenceDot confidence={a.confidence} />
      </span>
    </div>
  );
}

function Card({ title, sub, accent, children }) {
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

function ReconciliationCard({ rows, currency }) {
  return (
    <Card title="Reconciliation" sub="platform · blended · causal">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 8 }} className="font-mono">
        <span>Channel</span><span style={{ textAlign: 'right' }}>Platform</span><span style={{ textAlign: 'right' }}>Blended</span><span style={{ textAlign: 'right' }}>Incremental</span>
      </div>
      {rows.map((r) => (
        <div key={r.channel} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, padding: '10px 0', borderTop: '1px solid var(--c-surface-border)', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--c-text-base)' }}>{r.channel}</div>
            {r.gaps.platformVsBlendedMinor > 0 && (
              <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-warn-deep, #9a6a10)' }}>
                platform over-reports {formatCurrency(r.gaps.platformVsBlendedMinor, currency)}
              </div>
            )}
          </div>
          <AttributedValue a={r.platform} currency={currency} />
          <AttributedValue a={r.blended} currency={currency} />
          <AttributedValue a={r.incremental} currency={currency} />
        </div>
      ))}
      <p style={{ fontSize: 12, color: 'var(--c-text-muted)', marginTop: 12, lineHeight: 1.5 }}>
        The platform claims one number; blended truth says another; only the <strong style={{ color: 'var(--c-text-base)' }}>incremental</strong> column is proven causal — and only where a holdout was run.
      </p>
    </Card>
  );
}

function AttributionCard({ attribution }) {
  return (
    <Card title="Attribution models" accent={<span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>· honest by default</span>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {attribution.available.map((m) => (
          <div key={m.model} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--c-surface-elevated)' }}>
            <Icons.Check style={{ fontSize: 14, color: 'var(--c-ok-deep, #1f8a4c)' }} aria-hidden="true" />
            <span className="font-mono" style={{ fontSize: 12, color: 'var(--c-text-base)' }}>{m.model.replace(/_/g, ' ').toLowerCase()}</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--c-text-muted)' }}>{m.note}</span>
          </div>
        ))}
        {attribution.dark.map((m) => (
          <div key={m.model} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, border: '1px dashed var(--c-surface-border)' }}>
            <Icons.Activity style={{ fontSize: 14, color: 'var(--c-text-muted)' }} aria-hidden="true" />
            <span className="font-mono" style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{m.model.replace(/_/g, ' ').toLowerCase()}</span>
            <span className="font-mono" style={{ marginLeft: 'auto', fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>insufficient data — {m.reason}</span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12, color: 'var(--c-text-muted)', marginTop: 12, lineHeight: 1.5 }}>
        We don't have user-journey data, so first/linear/position-based attribution stay <strong style={{ color: 'var(--c-text-base)' }}>dark</strong> rather than invent credit. The causal model is <strong style={{ color: 'var(--c-text-base)' }}>incrementality-weighted — not Google DDA</strong>.
      </p>
    </Card>
  );
}

function CiBar({ ci, liftPct }) {
  // Map a [lo, hi]% CI onto a -10%..+40% track; mark zero.
  const lo = ci[0], hi = ci[1];
  const min = -10, max = 40;
  const pct = (v) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  const crossesZero = lo <= 0 && hi >= 0;
  const color = crossesZero ? 'var(--c-warn-deep, #9a6a10)' : 'var(--c-ok-deep, #1f8a4c)';
  return (
    <div style={{ position: 'relative', height: 26, marginTop: 10 }}>
      <div style={{ position: 'absolute', top: 11, left: 0, right: 0, height: 4, borderRadius: 2, background: 'var(--c-surface-elevated)' }} />
      <div style={{ position: 'absolute', top: 11, left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%`, height: 4, borderRadius: 2, background: color }} />
      {/* zero marker */}
      <div style={{ position: 'absolute', top: 6, left: `${pct(0)}%`, width: 1, height: 14, background: 'var(--c-text-muted)' }} />
      <div className="font-mono" style={{ position: 'absolute', top: 0, left: `${pct(liftPct)}%`, transform: 'translateX(-50%)', fontSize: 11, fontWeight: 700, color }}>{liftPct > 0 ? '+' : ''}{liftPct}%</div>
    </div>
  );
}

function IncrementalityCard({ holdout, inconclusive, currency }) {
  return (
    <Card title="Incrementality" sub="causal lift, as an interval">
      {/* The conclusive holdout */}
      <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--c-surface-elevated)', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text-base)' }}>{holdout.channel} holdout</span>
          <span className="font-mono" style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, background: 'var(--c-ok-soft, rgba(34,160,90,0.12))', color: 'var(--c-ok-deep, #1f8a4c)', border: '1px solid var(--c-ok-deep, #1f8a4c)33' }}>{holdout.confidenceLabel}</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c-text-muted)' }}>{formatCurrency(holdout.incrementalRevenueMinor, currency)} incremental</span>
        </div>
        <CiBar ci={holdout.ci} liftPct={holdout.liftPct} />
        <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 6 }}>
          95% CI [{holdout.ci[0]}%, {holdout.ci[1]}%] · n={holdout.sampleSizePerArm.toLocaleString('en-US')}/arm · {holdout.durationDays}d
        </div>
      </div>

      {/* The inconclusive one — refuses to call it */}
      <div style={{ display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1px dashed var(--c-surface-border)' }}>
        <Icons.Activity style={{ fontSize: 16, color: 'var(--c-warn-deep, #9a6a10)', flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
        <div>
          <div style={{ fontSize: 13, color: 'var(--c-text-base)', marginBottom: 2 }}>{inconclusive.channel} holdout — <strong>INCONCLUSIVE</strong></div>
          <div style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{inconclusive.rationale}</div>
        </div>
      </div>
    </Card>
  );
}

function AllocationFeedCard({ feed }) {
  const { meta } = feed;
  return (
    <Card title="Allocation, on causal truth" sub="incremental, not claimed">
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 14px', borderRadius: 10, background: 'var(--c-surface-elevated)' }}>
        <div>
          <div className="font-mono" style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>Meta claimed ROAS</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-text-muted)', textDecoration: 'line-through' }}>{meta.claimedRoas.toFixed(1)}x</div>
        </div>
        <Icons.ArrowRight style={{ fontSize: 18, color: 'var(--c-text-muted)' }} aria-hidden="true" />
        <div>
          <div className="font-mono" style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>Incremental ROAS</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-ok-deep, #1f8a4c)' }}>{meta.incrementalRoas.toFixed(1)}x</div>
        </div>
      </div>
      <p style={{ fontSize: 13, color: 'var(--c-text-base)', marginTop: 12, lineHeight: 1.5 }}>{feed.note}</p>
    </Card>
  );
}

function LockedState({ workspace }) {
  return (
    <div style={{ maxWidth: 620, margin: '40px auto 0', textAlign: 'center', padding: '40px 24px', borderRadius: 16, border: '1px dashed var(--c-surface-border)', background: 'var(--c-surface-card)' }}>
      <Icons.Search style={{ fontSize: 30, color: 'var(--c-text-muted)', marginBottom: 14 }} aria-hidden="true" />
      <h2 className="font-display" style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px', color: 'var(--c-text-base)' }}>Measurement is an Agency / Enterprise capability</h2>
      <p style={{ fontSize: 14, color: 'var(--c-text-muted)', lineHeight: 1.6, margin: 0 }}>
        Attribution and incrementality are deep, causal measurement — worth turning on when you're ready to invest in proving (not just claiming) what drove revenue. {workspace?.name ?? 'This workspace'} is on the core tier; blended truth in Portfolio already covers most of the practical need.
      </p>
    </div>
  );
}

export function MeasurePage({ workspace }) {
  const persona = workspace?.id ?? 'apparel';
  const data = DEMO_DATA.MEASUREMENT_BY_WS?.[persona] ?? { tier: 'NONE' };
  const currency = workspace?.currency ?? 'EGP';
  const gated = !data || data.tier === 'NONE';

  return (
    <div data-screen-label="Measure" style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 32px 48px' }}>
      <header style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>
            Measure · {workspace?.name ?? 'Workspace'}
          </span>
          {!gated && (
            <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 5, background: 'var(--c-accent-soft, rgba(201,154,59,0.12))', color: 'var(--c-accent, #C99A3B)', border: '1px solid var(--c-accent, #C99A3B)33' }}>
              {data.tier}
            </span>
          )}
        </div>
        <h1 className="font-display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, color: 'var(--c-text-base)' }}>
          Was it real? — measurement you can defend.
        </h1>
        <p style={{ fontSize: 14, color: 'var(--c-text-muted)', marginTop: 8, maxWidth: 800 }}>
          Every number here carries <strong style={{ color: 'var(--c-text-base)' }}>where it came from and how much to trust it</strong>. Lumi will show you an honest "insufficient data" before it shows you a confident number it can't defend.
        </p>
      </header>

      {gated ? (
        <LockedState workspace={workspace} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16, alignItems: 'start' }}>
          <ReconciliationCard rows={data.reconciliation} currency={currency} />
          <AttributionCard attribution={data.attribution} />
          <IncrementalityCard holdout={data.holdout} inconclusive={data.inconclusive} currency={currency} />
          <AllocationFeedCard feed={data.allocationFeed} />
        </div>
      )}
    </div>
  );
}

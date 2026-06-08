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

/**
 * Render a compact, uppercase label chip for an attribution source.
 *
 * @param {{source: string}} props - Component props.
 * @param {string} props.source - Source key to display; uses a human-friendly label when available.
 * @returns {JSX.Element} The chip element showing the mapped label or the raw source. 
 */
function SourceChip({ source }) {
  return (
    <span className="font-mono" style={{
      fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4,
      background: 'var(--c-surface-elevated)', color: 'var(--c-text-muted)', border: '1px solid var(--c-surface-border)',
    }}>{SOURCE_LABEL[source] ?? source}</span>
  );
}

/**
 * Render a small circular color indicator for a confidence level with a tooltip.
 *
 * @param {('HIGH'|'MEDIUM'|'LOW'|string)} confidence - Confidence key used to select the dot color; unknown keys fall back to a muted color.
 * @returns {JSX.Element} A span element sized 8×8px, circular and colored for the given confidence, with a title of "{confidence} confidence".
 */
function ConfidenceDot({ confidence }) {
  return (
    <span title={`${confidence} confidence`} style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: CONF_COLOR[confidence] ?? 'var(--c-text-muted)',
    }} />
  );
}

/**
 * Render an attributed monetary value with its source and confidence badge.
 *
 * @param {Object} props
 * @param {{value: number|null, source?: string, confidence?: string, caveat?: string}|null} props.a - Attribution data; when falsy the component renders an em dash. If present, `value` may be `null` to indicate "no causal read"; `caveat` is used as tooltip text.
 * @param {string} props.currency - Currency code passed to formatCurrency for numeric values.
 * @param {'right'|'left'} [props.align='right'] - Horizontal alignment for the rendered content.
 * @returns {JSX.Element} A React element showing the formatted value (or placeholder), plus a source chip and a confidence dot.
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

/**
 * Render a styled card with a header (title, optional accent, and optional right-aligned sub) and body content.
 *
 * @param {object} props - Component props.
 * @param {string|JSX.Element} props.title - Header title shown on the left.
 * @param {string|JSX.Element} [props.sub] - Optional right-aligned subheading displayed in muted text.
 * @param {JSX.Element} [props.accent] - Optional element rendered next to the title (e.g., a badge).
 * @param {JSX.Element} props.children - Card body content rendered below the header.
 * @returns {JSX.Element} The card element containing the header and children. 
 */
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

/**
 * Render a reconciliation card comparing platform, blended, and incremental values per channel.
 *
 * Renders a four-column grid with a header row, one row per channel (showing a channel label, platform, blended, and incremental attributed values), an inline warning when platform over-reports blended, and a short explanatory note about incremental being the proven causal column only when a holdout exists.
 *
 * @param {Object} props
 * @param {Array<Object>} props.rows - Array of reconciliation rows. Each row should include at least: `channel` (string), `gaps.platformVsBlendedMinor` (number), and `platform`, `blended`, `incremental` attributed-value objects consumed by AttributedValue.
 * @param {string} props.currency - Currency code used by formatCurrency when rendering monetary values.
 * @returns {import('react').ReactElement} The reconciliation card element.
 */
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

/**
 * Render the "Attribution models" card listing available and dark (insufficient-data) attribution models.
 * @param {{ available: { model: string, note?: string }[], dark: { model: string, reason: string }[] }} attribution - Attribution groups to display. `available` items show `model` and optional `note`; `dark` items show `model` and `reason` for being insufficient.
 * @returns {JSX.Element} The card element containing the lists and explanatory note.
 */
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

/**
 * Render a horizontal confidence-interval bar with a zero marker and a positioned lift percentage label.
 *
 * @param {{ci: [number, number], liftPct: number}} props
 * @param {[number, number]} props.ci - Two-element array [lo, hi] giving the confidence interval bounds in percent.
 * @param {number} props.liftPct - Lift percentage used to position and label the marker on the bar.
 * @returns {JSX.Element} The rendered confidence-interval bar with colored interval, zero marker, and lift label.
 */
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

/**
 * Render the Incrementality card showing a conclusive holdout's lift interval and an inconclusive example.
 *
 * @param {Object} props
 * @param {Object} props.holdout - Data for the conclusive holdout.
 * @param {string} props.holdout.channel - Holdout channel name.
 * @param {string} props.holdout.confidenceLabel - Short confidence label (e.g., "95%").
 * @param {number} props.holdout.incrementalRevenueMinor - Incremental revenue in minor currency units.
 * @param {number[]} props.holdout.ci - 2-element confidence interval as percentages [lo, hi].
 * @param {number} props.holdout.liftPct - Point estimate lift percentage used for positioning the label.
 * @param {number} props.holdout.sampleSizePerArm - Sample size per arm.
 * @param {number} props.holdout.durationDays - Duration of the holdout in days.
 * @param {Object} props.inconclusive - Data for the inconclusive example.
 * @param {string} props.inconclusive.channel - Holdout channel name for the inconclusive example.
 * @param {string} props.inconclusive.rationale - Short explanation why the result is inconclusive.
 * @param {string} props.currency - ISO currency code used to format monetary values.
 * @returns {JSX.Element} The rendered Incrementality card component.
 */
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

/**
 * Render a card comparing a meta (claimed) ROAS to the incremental (causal) ROAS and display an explanatory note.
 *
 * @param {object} props
 * @param {object} props.feed - Allocation feed data.
 * @param {object} props.feed.meta - Meta information containing ROAS values.
 * @param {number} props.feed.meta.claimedRoas - The claimed ROAS from meta data (displayed struck through).
 * @param {number} props.feed.meta.incrementalRoas - The incremental (causal) ROAS (displayed as the emphasized value).
 * @param {string} props.feed.note - Descriptive note or explanation shown below the ROAS comparison.
 * @returns {JSX.Element} A card element that visualizes claimed vs incremental ROAS and renders the feed note.
 */
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

/**
 * Render a centered locked/gated UI explaining that advanced measurement is reserved for Agency/Enterprise tiers.
 *
 * Displays a dashed panel with an icon, a title, and explanatory text. The panel references the workspace name when provided.
 *
 * @param {{name?: string}} workspace - Workspace object; `workspace.name` (if present) is inserted into the message, otherwise "This workspace" is used.
 * @returns {JSX.Element} The locked-state React element.
 */
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

/**
 * Render the "Measure" page that either shows a locked, tier-gated message or a set of measurement cards.
 *
 * Renders a header with workspace context and, when measurement is available for the workspace's persona, a responsive grid containing reconciliation, attribution, incrementality, and allocation cards; otherwise renders a locked state prompting upgrade.
 *
 * @param {Object} props.workspace - Optional workspace object used to determine persona and display context. Expected fields: `id` (persona key), `name` (display name), and `currency` (ISO currency code).
 * @returns {JSX.Element} The Measure page UI.
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

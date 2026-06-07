// ============================================================
// Lumi — Memory page (Phase 5: the compounding moat)
// ============================================================
// "What Lumi has learned about this account." The moat made legible:
//   • patterns stated plainly, each with "Lumi was right X%" (accuracy,
//     not just volume) + an EMERGING/ESTABLISHED badge + recency note;
//   • one-tap "Make it a rule" on PROVEN patterns (routes to confirm) —
//     disabled for conflicted/unproven ones;
//   • a conflicts callout (two competing rules — review, never silent);
//   • a network panel honest about the cold start: dark + opt-in, with a
//     consented example shown as an accuracy BAND, never a point claim.
// ============================================================

import { Icons } from './icons.jsx';
import { DEMO_DATA } from './data.js';

const KIND_LABEL = {
  FATIGUE_CEILING: 'Fatigue ceiling', SCALING_WINDOW: 'Scaling window',
  CREATIVE_ANGLE_LONGEVITY: 'Creative angle', SEASONAL_EFFECT: 'Seasonal',
};

function KindChip({ kind }) {
  return (
    <span className="font-mono" style={{
      fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '3px 8px',
      borderRadius: 5, whiteSpace: 'nowrap', background: 'var(--c-surface-elevated)',
      color: 'var(--c-text-muted)', border: '1px solid var(--c-surface-border)',
    }}>{KIND_LABEL[kind] ?? kind}</span>
  );
}

function StatusBadge({ status }) {
  const established = status === 'ESTABLISHED';
  return (
    <span className="font-mono" title={established ? 'Enough proven history to act on' : 'Seen, but not yet proven'}
      style={{
        fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 5,
        background: established ? 'var(--c-ok-soft, rgba(34,160,90,0.12))' : 'var(--c-surface-elevated)',
        color: established ? 'var(--c-ok-deep, #1f8a4c)' : 'var(--c-text-muted)',
        border: `1px solid ${established ? 'var(--c-ok-deep, #1f8a4c)' : 'var(--c-surface-border)'}33`,
      }}>{status}</span>
  );
}

function PatternCard({ p }) {
  const [promoted, setPromoted] = React.useState(false);
  return (
    <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 12, padding: 16, boxShadow: 'var(--sh-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <KindChip kind={p.kind} />
        <StatusBadge status={p.status} />
        <span className="font-mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--c-text-muted)' }}>
          Lumi was right <strong style={{ color: p.accuracy >= 0.6 ? 'var(--c-ok-deep, #1f8a4c)' : 'var(--c-text-base)' }}>{Math.round((p.accuracy ?? 0) * 100)}%</strong> · {p.support}×
        </span>
      </div>
      <p style={{ fontSize: 14, color: 'var(--c-text-base)', margin: '0 0 6px', lineHeight: 1.5 }}>{p.statement}</p>
      <p style={{ fontSize: 12, color: 'var(--c-text-muted)', margin: '0 0 12px' }}>Seen {p.recency}.</p>
      {p.promotable ? (
        promoted ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--c-ok-deep, #1f8a4c)' }}>
            <Icons.Check style={{ fontSize: 15 }} aria-hidden="true" /> Promoted to a guardrail — it now runs on every sweep (you still confirm each verdict).
          </div>
        ) : (
          <button type="button" className="btn-gold" onClick={() => setPromoted(true)} style={{ height: 34 }}>
            <Icons.Zap style={{ fontSize: 13 }} aria-hidden="true" /> Make it a rule
          </button>
        )
      ) : (
        <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>
          {p.status === 'EMERGING' ? 'Not enough proven history to promote yet.' : 'Informational — no rule to make.'}
        </span>
      )}
    </div>
  );
}

export function MemoryPage({ workspace }) {
  const persona = workspace?.id ?? 'apparel';
  const data = DEMO_DATA.BRIEFING_BY_WS?.[persona] ?? DEMO_DATA.BRIEFING_BY_WS.apparel;
  const { patterns = [], conflicts = [], network = {}, networkExample } = data;
  const [optedIn, setOptedIn] = React.useState(false);

  return (
    <div data-screen-label="Memory" style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 32px 48px' }}>
      {/* Header */}
      <header style={{ marginBottom: 22 }}>
        <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 8 }}>
          Memory · {workspace?.name ?? 'Workspace'}
        </div>
        <h1 className="font-display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, color: 'var(--c-text-base)' }}>
          What Lumi has learned about this account.
        </h1>
        <p style={{ fontSize: 14, color: 'var(--c-text-muted)', marginTop: 8, maxWidth: 760 }}>
          Every verdict, test, and reallocation feeds this. Patterns are <strong style={{ color: 'var(--c-text-base)' }}>truth-weighted</strong> —
          ranked by how often Lumi was actually right, with recent evidence counting more than old.
        </p>
      </header>

      {/* Patterns */}
      <section style={{ marginBottom: 30 }}>
        <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px', color: 'var(--c-text-base)' }}>Learned patterns</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
          {patterns.map((p) => <PatternCard key={p.id} p={p} />)}
          {patterns.length === 0 && <div style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>No durable patterns yet — give Lumi a few weeks of decisions.</div>}
        </div>
      </section>

      {/* Conflicts */}
      {conflicts.length > 0 && (
        <section style={{ marginBottom: 30 }}>
          <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px', color: 'var(--c-text-base)' }}>Needs your review</h2>
          {conflicts.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 12, padding: '14px 16px', borderRadius: 12, background: 'var(--c-warn-soft, rgba(200,140,20,0.10))', border: '1px solid var(--c-warn-deep, #9a6a10)33' }}>
              <Icons.Activity style={{ fontSize: 18, color: 'var(--c-warn-deep, #9a6a10)', flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
              <div>
                <p style={{ fontSize: 14, color: 'var(--c-text-base)', margin: '0 0 4px', fontWeight: 600 }}>{c.statement}</p>
                <p style={{ fontSize: 13, color: 'var(--c-text-muted)', margin: 0 }}>{c.note}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Network — honest about the cold start */}
      <section>
        <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px', color: 'var(--c-text-base)' }}>Network intelligence</h2>
        <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, padding: 18, boxShadow: 'var(--sh-card)' }}>
          {!optedIn ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <Icons.Layers style={{ fontSize: 18, color: 'var(--c-text-muted)' }} aria-hidden="true" />
                <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>Off by default · opt-in</span>
              </div>
              <p style={{ fontSize: 14, color: 'var(--c-text-base)', margin: '0 0 8px', lineHeight: 1.5 }}>
                With your consent, Lumi can compare your <strong>anonymized</strong> patterns against other consenting accounts in your
                cohort — and tell you when a learning holds market-wide. It lights up only at scale, and always as a confidence band, never a single number.
              </p>
              {networkExample && (
                <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--c-surface-elevated)', marginBottom: 14 }}>
                  <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 6 }}>Example (what you'd see)</div>
                  <p style={{ fontSize: 13, color: 'var(--c-text-base)', margin: '0 0 6px' }}>{networkExample.statement}</p>
                  <div style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>
                    Confidence band {Math.round(networkExample.band[0] * 100)}–{Math.round(networkExample.band[1] * 100)}% ·
                    {' '}{networkExample.contributingWorkspaces} consenting accounts (anonymized)
                  </div>
                </div>
              )}
              <button type="button" className="btn-gold" onClick={() => setOptedIn(true)} style={{ height: 36 }}>
                <Icons.Check style={{ fontSize: 14 }} aria-hidden="true" /> Opt in to the network
              </button>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Icons.Check style={{ fontSize: 16, color: 'var(--c-ok-deep, #1f8a4c)' }} aria-hidden="true" />
              <span style={{ fontSize: 14, color: 'var(--c-text-base)' }}>
                Opted in. Network insights will appear here once enough accounts in your cohort consent —
                until then, it honestly stays empty (no fabricated "across the market" claims).
              </span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

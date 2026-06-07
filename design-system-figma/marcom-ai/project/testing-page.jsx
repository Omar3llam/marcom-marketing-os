// ============================================================
// Lumi — Testing OS page (Phase 4: closed-loop experiments)
// ============================================================
// The recurring-engagement surface. Three bands:
//   • Weekly agenda — ranked, hypothesis-backed test suggestions
//     across HOOK / OFFER / AUDIENCE / CREATIVE_ANGLE.
//   • In-flight — running experiments with their variants.
//   • Concluded — the CLOSED LOOP: a winner read honestly (confidence
//     labeled, thin samples flagged), a REFRESH/SCALE verdict that
//     routes to confirm, and a "written to memory" badge proving the
//     outcome fed Decision Memory.
// ============================================================

import { Icons } from './icons.jsx';
import { VerdictPill } from './primitives.jsx';
import { DEMO_DATA } from './data.js';

const DIM_LABEL = {
  HOOK: 'Hook A/B', OFFER: 'Offer angle', AUDIENCE: 'Audience', CREATIVE_ANGLE: 'Creative angle',
};

/**
 * Render a compact, uppercase label for a test dimension.
 * @param {{dimension: string}} props - `dimension` is the dimension key to display; if a friendly name exists in `DIM_LABEL` it will be used, otherwise `dimension` is shown as-is.
 * @returns {JSX.Element} A styled <span> element containing the dimension label.
 */
function DimChip({ dimension }) {
  return (
    <span className="font-mono" style={{
      fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '3px 8px',
      borderRadius: 5, whiteSpace: 'nowrap', background: 'var(--c-surface-elevated)',
      color: 'var(--c-text-muted)', border: '1px solid var(--c-surface-border)',
    }}>{DIM_LABEL[dimension] ?? dimension}</span>
  );
}

/**
 * Render a compact confidence badge that displays a label and visual styling based on its strength.
 *
 * @param {Object} props
 * @param {string} props.label - Confidence label text; `'HIGH'` or `'MODERATE'` are treated as strong confidence.
 * @returns {JSX.Element} A styled <span> showing the label with a title that indicates whether the result is "Statistically warranted" (strong) or "Sample too thin / no clear winner — not callable" (other labels).
 */
function ConfidenceBadge({ label }) {
  const strong = label === 'HIGH' || label === 'MODERATE';
  return (
    <span className="font-mono" title={strong ? 'Statistically warranted' : 'Sample too thin / no clear winner — not callable'}
      style={{
        fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 7px',
        borderRadius: 5, whiteSpace: 'nowrap',
        background: strong ? 'var(--c-ok-soft, rgba(34,160,90,0.12))' : 'var(--c-warn-soft, rgba(200,140,20,0.14))',
        color: strong ? 'var(--c-ok-deep, #1f8a4c)' : 'var(--c-warn-deep, #9a6a10)',
      }}>{label}</span>
  );
}

/**
 * Render a card for a single testing agenda suggestion with UI to mark it as proposed.
 *
 * @param {Object} props
 * @param {Object} props.s - Suggestion data to display.
 * @param {string} props.s.dimension - Dimension key (e.g., "HOOK", "OFFER") used for the dimension chip.
 * @param {string} props.s.name - Display name of the suggested test.
 * @param {string} props.s.metric - Metric being watched for the test.
 * @param {number|string} props.s.priority - Priority score; displayed as a decimal with one digit.
 * @param {string} props.s.hypothesis - Hypothesis text for the suggestion.
 * @param {string} props.s.expectedSignal - Short description of the expected signal.
 * @param {Array<{label: string, isControl?: boolean}>} props.s.variants - List of variants; each variant shows its label and whether it is the control.
 * @returns {JSX.Element} A React element representing the suggestion card.
 */
function SuggestionCard({ s }) {
  const [proposed, setProposed] = React.useState(false);
  return (
    <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 12, padding: 16, boxShadow: 'var(--sh-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <DimChip dimension={s.dimension} />
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--c-text-base)' }}>{s.name}</span>
        <span className="font-mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--c-text-muted)' }}>
          watch {s.metric} · pri {Number(s.priority).toFixed(1)}
        </span>
      </div>
      <p style={{ fontSize: 13, color: 'var(--c-text-base)', margin: '0 0 6px', lineHeight: 1.5 }}>{s.hypothesis}</p>
      <p style={{ fontSize: 12, color: 'var(--c-text-muted)', margin: '0 0 12px' }}>
        <Icons.Activity style={{ fontSize: 12, verticalAlign: '-1px', marginRight: 4 }} aria-hidden="true" />
        Expected signal: {s.expectedSignal}
      </p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {s.variants.map((v) => (
          <span key={v.label} className="font-mono" style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5,
            background: 'var(--c-surface-elevated)', color: 'var(--c-text-muted)', border: '1px solid var(--c-surface-border)' }}>
            {v.label}{v.isControl ? ' · control' : ''}
          </span>
        ))}
      </div>
      {proposed ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--c-ok-deep, #1f8a4c)' }}>
          <Icons.Check style={{ fontSize: 15 }} aria-hidden="true" /> Queued as a proposed test.
        </div>
      ) : (
        <button type="button" className="btn-gold" onClick={() => setProposed(true)} style={{ height: 34 }}>
          <Icons.Zap style={{ fontSize: 13 }} aria-hidden="true" /> Propose test
        </button>
      )}
    </div>
  );
}

/**
 * Render the Testing OS page that presents a ranked weekly agenda, running experiments, and concluded tests for a workspace.
 *
 * Renders three sections sourced from demo data keyed by `workspace.id`: "This week's agenda" (suggested tests), "In flight" (running experiments, shown if any), and "Concluded" (closed-loop outcomes and rationale). Each section displays dimension chips, variant details, confidence/verdict indicators, and memory/write status where applicable.
 *
 * @param {{ id?: string, name?: string }} props.workspace - Workspace context used to select persona-specific demo data and to display the workspace name.
 * @returns {JSX.Element} The Testing page component tree.
 */
export function TestingPage({ workspace }) {
  const persona = workspace?.id ?? 'apparel';
  const data = DEMO_DATA.TESTING_BY_WS?.[persona] ?? DEMO_DATA.TESTING_BY_WS.apparel;
  const { agenda = [], running = [], concluded = [] } = data;

  return (
    <div data-screen-label="Testing" style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 32px 48px' }}>
      {/* Header */}
      <header style={{ marginBottom: 22 }}>
        <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 8 }}>
          Testing OS · {workspace?.name ?? 'Workspace'}
        </div>
        <h1 className="font-display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, color: 'var(--c-text-base)' }}>
          What to test this week.
        </h1>
        <p style={{ fontSize: 14, color: 'var(--c-text-muted)', marginTop: 8, maxWidth: 760 }}>
          A ranked, hypothesis-backed agenda — and every concluded test writes its outcome to
          <strong style={{ color: 'var(--c-text-base)' }}> Decision Memory</strong>, sharpening the next verdict and the next suggestion.
        </p>
      </header>

      {/* Weekly agenda */}
      <section style={{ marginBottom: 30 }}>
        <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px', color: 'var(--c-text-base)' }}>This week's agenda</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
          {agenda.map((s) => <SuggestionCard key={`${s.entityId}-${s.dimension}`} s={s} />)}
          {agenda.length === 0 && <div style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>No tests warranted — everything's healthy.</div>}
        </div>
      </section>

      {/* In-flight */}
      {running.length > 0 && (
        <section style={{ marginBottom: 30 }}>
          <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px', color: 'var(--c-text-base)' }}>In flight</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {running.map((t) => (
              <div key={t.id} style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 12, padding: 16, boxShadow: 'var(--sh-card)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <DimChip dimension={t.dimension} />
                  <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--c-text-base)' }}>{t.name}</span>
                  <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-gold-deep)', marginLeft: 'auto' }}>Running · watch {t.metric}</span>
                </div>
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                  {t.variants.map((v) => (
                    <div key={v.label} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span className="font-mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--c-text-base)' }}>{v.label}{v.isControl ? ' · control' : ''}</span>
                      <span style={{ fontSize: 13, color: 'var(--c-text-base)' }}>{v.metricText}</span>
                      <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{v.sampleText}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Concluded — the closed loop */}
      <section>
        <h2 className="font-display" style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px', color: 'var(--c-text-base)' }}>Concluded</h2>
        <div style={{ fontSize: 13, color: 'var(--c-text-muted)', marginBottom: 12 }}>A test is finished only when its outcome is recorded.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {concluded.map((t) => (
            <div key={t.id} style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 12, padding: 16, boxShadow: 'var(--sh-card)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <DimChip dimension={t.dimension} />
                <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--c-text-base)' }}>{t.name}</span>
                <ConfidenceBadge label={t.confidenceLabel} />
                {t.verdict
                  ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><VerdictPill verdict={t.verdict} /></span>
                  : <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>no verdict — not callable</span>}
                {t.memoryWritten && (
                  <span className="font-mono" title="Outcome recorded to Decision Memory"
                    style={{ marginLeft: 'auto', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 5,
                      background: 'var(--c-surface-elevated)', color: 'var(--c-text-muted)', border: '1px solid var(--c-surface-border)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Icons.Check style={{ fontSize: 12 }} aria-hidden="true" /> Written to memory
                  </span>
                )}
              </div>
              <p style={{ fontSize: 13, color: 'var(--c-text-base)', margin: '0 0 8px', lineHeight: 1.5 }}>{t.rationale}</p>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 8 }}>
                {t.variants.map((v) => (
                  <div key={v.label} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span className="font-mono" style={{ fontSize: 12, fontWeight: 700, color: v.isWinner ? 'var(--c-ok-deep, #1f8a4c)' : 'var(--c-text-base)' }}>
                      {v.label}{v.isControl ? ' · control' : ''}{v.isWinner ? ' · winner' : ''}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--c-text-base)' }}>{v.metricText}</span>
                  </div>
                ))}
              </div>
              <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{t.sampleNote}</div>
              {t.verdict && (
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--c-text-muted)' }}>
                  Verdict routes to confirm → execute governance. Lumi never auto-acts on a test.
                </div>
              )}
            </div>
          ))}
          {concluded.length === 0 && <div style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>No concluded tests yet.</div>}
        </div>
      </section>
    </div>
  );
}

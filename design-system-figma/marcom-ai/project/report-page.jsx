// ============================================================
// Lumi — Report page (Phase 8: the Collaboration & Reporting OS)
// ============================================================
// "What happened, and why." The auto-generated stakeholder narrative —
// reasoned PROSE, never a chart-and-filter dump (the anti-Looker guard).
//   • Every number is an inline EVIDENCE CHIP (value + the row it came from),
//     the visible proof of zero-hallucination.
//   • A "Report Confidence" badge up top, expandable to its 4 drivers — so a
//     CEO knows whether the prose rests on strong or partial data. Never bare.
//   • A role switcher (Strategist / Buyer / Client) re-scopes the nav live —
//     three roles, three surfaces.
//   • An approvals strip: a pending plan → Approve / Reject → an audit line.
// NO charts. NO filters. That is the point.
// ============================================================

import { Icons } from './icons.jsx';
import { DEMO_DATA } from './data.js';
import { formatCurrency } from './primitives.jsx';

const MONEY_UNITS = new Set(['EGP', 'USD', 'SAR', 'AED']);
const KIND_LABEL = { DECISION: 'decision', OUTCOME: 'outcome', ALLOCATION: 'plan', INCREMENTALITY: 'holdout', GOAL: 'goal', BLENDED: 'blended' };
const ROLES = [
  { key: 'STRATEGIST', label: 'Strategist', sub: 'full surface' },
  { key: 'BUYER',      label: 'Buyer',      sub: 'execution + reports' },
  { key: 'CLIENT',     label: 'Client',     sub: 'reports only' },
];
const CONF_COLOR = { HIGH: 'var(--c-ok-deep, #1f8a4c)', MODERATE: 'var(--c-warn-deep, #9a6a10)', LOW: 'var(--c-text-muted)' };

function fmtFigure(f) {
  if (MONEY_UNITS.has(f.unit)) return formatCurrency(f.value, f.unit);
  if (f.unit === '%') return `${f.value}%`;
  if (f.unit === 'x') return `${f.value}x`;
  return `${f.value}${f.unit ? ` ${f.unit}` : ''}`;
}

// A number bound to its evidence — reads as "click through to the row".
function EvidenceChip({ figure }) {
  return (
    <span
      title={`Evidence: ${figure.evidenceRef}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '1px 7px', margin: '0 2px',
        borderRadius: 6, background: 'var(--c-surface-elevated)', border: '1px solid var(--c-surface-border)',
        fontWeight: 600, color: 'var(--c-text-base)', whiteSpace: 'nowrap', cursor: 'help',
      }}
    >
      {fmtFigure(figure)}
      <span className="font-mono" style={{ fontSize: 9, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>
        {KIND_LABEL[figure.kind] ?? 'ref'}
      </span>
    </span>
  );
}

// Render claim prose with the cited figures appended as chips.
function ClaimLine({ claim }) {
  return (
    <li style={{ marginBottom: 10, lineHeight: 1.6, color: 'var(--c-text-base)', fontSize: 14 }}>
      <span>{claim.text}</span>
      {claim.figures.length > 0 && (
        <span style={{ marginLeft: 6 }}>
          {claim.figures.map((f, i) => <EvidenceChip key={i} figure={f} />)}
        </span>
      )}
    </li>
  );
}

function ConfidenceBadge({ confidence }) {
  const [open, setOpen] = React.useState(false);
  const color = CONF_COLOR[confidence.label] ?? 'var(--c-text-muted)';
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((p) => !p)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12,
          background: 'var(--c-surface-card)', border: `1px solid ${color}44`, cursor: 'pointer',
        }}
        aria-expanded={open}
      >
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: color }} />
        <div style={{ textAlign: 'left' }}>
          <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>Report confidence</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-text-base)' }}>{confidence.score}% <span style={{ fontSize: 12, fontWeight: 600, color }}>{confidence.label}</span></div>
        </div>
        <Icons.ArrowRight style={{ fontSize: 14, color: 'var(--c-text-muted)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} aria-hidden="true" />
      </button>
      {open && (
        <div style={{ marginTop: 8, padding: 14, borderRadius: 12, background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)' }}>
          <p style={{ fontSize: 12, color: 'var(--c-text-muted)', margin: '0 0 10px', lineHeight: 1.5 }}>
            Blended from four real coverage signals — partial data lowers it honestly. The score is never a bare number.
          </p>
          {confidence.components.map((c) => (
            <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--c-text-base)', width: 170 }}>{c.label ?? c.key}</span>
              <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--c-surface-elevated)', overflow: 'hidden' }}>
                <div style={{ width: `${Math.round(c.value * 100)}%`, height: '100%', background: color }} />
              </div>
              <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)', width: 78, textAlign: 'right' }}>
                {Math.round(c.value * 100)}% · w{c.weight}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RoleSwitcher({ role, onRole }) {
  return (
    <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 10, background: 'var(--c-surface-elevated)', border: '1px solid var(--c-surface-border)' }}>
      {ROLES.map((r) => {
        const active = r.key === role;
        return (
          <button
            key={r.key}
            onClick={() => onRole?.(r.key)}
            title={`View as ${r.label} — ${r.sub}`}
            style={{
              padding: '6px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
              background: active ? 'var(--c-accent, #C99A3B)' : 'transparent',
              color: active ? 'var(--c-on-gold, #fff)' : 'var(--c-text-muted)',
              fontWeight: active ? 700 : 500, fontSize: 12,
            }}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}

function ApprovalStrip({ approval }) {
  const [state, setState] = React.useState(approval.state);
  const [audit, setAudit] = React.useState([]);
  const decide = (decision) => {
    setState(decision);
    setAudit((a) => [{ decision, at: 'just now', by: 'Strategist' }, ...a]);
  };
  const decided = state !== 'PENDING';
  return (
    <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, padding: 18, boxShadow: 'var(--sh-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <Icons.Check style={{ fontSize: 15, color: 'var(--c-accent, #C99A3B)' }} aria-hidden="true" />
        <h2 className="font-display" style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--c-text-base)' }}>Awaiting your approval</h2>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--c-text-muted)' }}>{approval.requestedAgo}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, background: 'var(--c-surface-elevated)' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text-base)' }}>{approval.subject}</div>
          <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 2 }}>
            requested by {approval.requestedBy} · a buyer cannot execute it until you sign off
          </div>
        </div>
        {!decided ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => decide('REJECTED')} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--c-surface-border)', background: 'transparent', color: 'var(--c-text-muted)', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Reject</button>
            <button onClick={() => decide('APPROVED')} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--c-ok-deep, #1f8a4c)', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>Approve</button>
          </div>
        ) : (
          <span className="font-mono" style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, textTransform: 'uppercase', letterSpacing: '0.05em',
            background: state === 'APPROVED' ? 'var(--c-ok-soft, rgba(34,160,90,0.12))' : 'var(--c-surface-card)',
            color: state === 'APPROVED' ? 'var(--c-ok-deep, #1f8a4c)' : 'var(--c-text-muted)',
            border: '1px solid var(--c-surface-border)' }}>{state}</span>
        )}
      </div>
      {audit.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 6 }}>Audit log</div>
          {audit.map((a, i) => (
            <div key={i} className="font-mono" style={{ fontSize: 12, color: 'var(--c-text-muted)', padding: '4px 0' }}>
              · {a.decision} by {a.by} · {a.at} — written to the collaboration audit
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NarrativeCard({ narrative }) {
  return (
    <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, padding: 22, boxShadow: 'var(--sh-card)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>
          {narrative.period} · {narrative.audience}
        </span>
      </div>
      <h2 className="font-display" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 18px', color: 'var(--c-text-base)' }}>{narrative.headline}</h2>
      {narrative.sections.map((s) => (
        <section key={s.key} style={{ marginBottom: 18 }}>
          <h3 className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)', margin: '0 0 8px' }}>{s.title}</h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {s.claims.map((c, i) => <ClaimLine key={i} claim={c} />)}
          </ul>
        </section>
      ))}
      <p style={{ fontSize: 12, color: 'var(--c-text-muted)', marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--c-surface-border)', lineHeight: 1.5 }}>
        Every figure above is bound to a real row ({narrative.sections.flatMap((s) => s.claims.flatMap((c) => c.figures)).length} evidence references). Lumi writes the reasoning; it never invents the numbers.
      </p>
    </div>
  );
}

export function ReportPage({ workspace, role = 'STRATEGIST', onRole }) {
  const persona = workspace?.id ?? 'apparel';
  const data = DEMO_DATA.COLLAB_BY_WS?.[persona] ?? DEMO_DATA.COLLAB_BY_WS?.apparel;
  const showApprovals = role === 'STRATEGIST' && data.approval;

  return (
    <div data-screen-label="Report" style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 32px 48px' }}>
      <header style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
          <span className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>
            Report · {workspace?.name ?? 'Workspace'}
          </span>
          <span style={{ marginLeft: 'auto' }}><RoleSwitcher role={role} onRole={onRole} /></span>
        </div>
        <h1 className="font-display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, color: 'var(--c-text-base)' }}>
          What happened, and why.
        </h1>
        <p style={{ fontSize: 14, color: 'var(--c-text-muted)', marginTop: 8, maxWidth: 760, lineHeight: 1.5 }}>
          A reasoned narrative a leader can read in a minute and defend in a board meeting — grounded in real decisions and memory, with <strong style={{ color: 'var(--c-text-base)' }}>zero hallucinated numbers</strong>. Viewing as <strong style={{ color: 'var(--c-text-base)' }}>{role.toLowerCase()}</strong> — the nav re-scopes to match.
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
        <ConfidenceBadge confidence={data.narrative.reportConfidence} />
        {showApprovals && <ApprovalStrip approval={data.approval} />}
        <NarrativeCard narrative={data.narrative} />
      </div>
    </div>
  );
}

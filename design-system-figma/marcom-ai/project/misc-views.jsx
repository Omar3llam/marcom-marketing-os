// ============================================================
// MARCOM Demo — Placeholder routes (Campaign list, Settings)
// ============================================================
// Lightweight stand-ins for nav targets that aren't part of the
// core decision flow demo.

import { Icons } from './icons.jsx';
import { VerdictPill, StagePill } from './primitives.jsx';

export function CampaignsList({ workspace, alerts, onStartFlow, onReviewAlert }) {
  return (
    <div data-screen-label="Campaign Analysis" style={{ maxWidth: 1280, margin: '0 auto', padding: '32px' }}>
      <header style={{ marginBottom: 24 }}>
        <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 8 }}>
          Campaign Analysis · {workspace.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <h1 className="font-display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, color: 'var(--c-text-base)' }}>
            14 ad sets, 3 verdicts pending.
          </h1>
          <button className="btn-gold" onClick={() => onStartFlow('campaign')}>
            <Icons.Upload style={{ fontSize: 14 }} />
            New scan
          </button>
        </div>
      </header>

      <div
        style={{
          background: 'var(--c-surface-card)',
          border: '1px solid var(--c-surface-border)',
          borderRadius: 16,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '12px 18px',
            background: 'var(--c-surface-elevated)',
            borderBottom: '1px solid var(--c-surface-border)',
            display: 'grid',
            gridTemplateColumns: '90px 1fr 120px 110px 110px 110px',
            gap: 16,
          }}
        >
          {['Verdict','Campaign / Ad set','Stage','CPA','Frequency','Time'].map((h) => (
            <span key={h} className="font-mono" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>{h}</span>
          ))}
        </div>
        {alerts.map((a) => (
          <div
            key={a.id}
            onClick={() => onReviewAlert(a)}
            style={{
              padding: '14px 18px',
              borderBottom: '1px solid var(--c-surface-border)',
              display: 'grid',
              gridTemplateColumns: '90px 1fr 120px 110px 110px 110px',
              gap: 16,
              alignItems: 'center',
              cursor: 'pointer',
              transition: 'background 120ms',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--c-surface-elevated)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <VerdictPill verdict={a.verdict} />
            <div>
              <div className="font-display" style={{ fontWeight: 500, fontSize: 14, color: 'var(--c-text-base)' }}>{a.campaign}</div>
              <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 2 }}>{a.adset}</div>
            </div>
            <StagePill stage={a.stage} />
            <span className="font-mono tabular-nums" style={{ fontSize: 12, color: 'var(--c-text-soft)' }}>{a.detail.match(/EGP|SAR|AED/) ? a.detail.split('·')[0].trim().split(' ')[1] || '—' : '—'}</span>
            <span className="font-mono tabular-nums" style={{ fontSize: 12, color: a.bleed !== '—' ? 'var(--c-kill-text)' : 'var(--c-text-muted)' }}>{a.bleed}</span>
            <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>{a.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GenericPage({ title, sub, Icon, locked = true }) {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '80px 32px', textAlign: 'center' }}>
      <div
        style={{
          width: 72, height: 72, borderRadius: 18, margin: '0 auto 18px',
          background: 'var(--c-surface-elevated)',
          color: 'var(--c-text-muted)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '1px solid var(--c-surface-border)',
        }}
      >
        <Icon style={{ fontSize: 32 }} />
      </div>
      <h1 className="font-display" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', margin: 0, color: 'var(--c-text-base)' }}>{title}</h1>
      <p style={{ marginTop: 8, fontSize: 14, color: 'var(--c-text-soft)', maxWidth: 480, margin: '8px auto 24px' }}>{sub}</p>
      {locked && (
        <div className="font-mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 999, background: 'var(--c-surface-elevated)', fontSize: 11, color: 'var(--c-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          <Icons.Lock style={{ fontSize: 12 }} />
          Phase 2 · Coming soon
        </div>
      )}
    </div>
  );
}


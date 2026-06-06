// ============================================================
// MARCOM Demo — Input View (CSV upload + validation)
// ============================================================

import { Icons } from './icons.jsx';

export function InputView({ workspace, featured, onAnalyze, onCancel }) {
  const [stage, setStage] = React.useState('idle'); // idle | dragging | uploading | parsed
  const [progress, setProgress] = React.useState(0);

  const startUpload = () => {
    setStage('uploading');
    setProgress(0);
    let p = 0;
    const id = setInterval(() => {
      p += 8 + Math.random() * 12;
      if (p >= 100) { p = 100; clearInterval(id); setStage('parsed'); }
      setProgress(p);
    }, 70);
  };

  return (
    <div data-screen-label="Input — CSV Upload" style={{ maxWidth: 960, margin: '0 auto', padding: '40px 32px' }}>
      <Breadcrumb crumbs={[
        { label: 'Command Hub', onClick: onCancel },
        { label: 'Campaign Intelligence' },
        { label: 'Input', active: true },
      ]} />

      <header style={{ marginBottom: 32 }}>
        <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-gold)', marginBottom: 8 }}>
          MODULE 01 · Campaign Intelligence
        </div>
        <h1 className="font-display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, color: 'var(--c-text-base)' }}>
          Drop a Meta CSV. Get a verdict.
        </h1>
        <p style={{ marginTop: 8, fontSize: 15, color: 'var(--c-text-soft)', maxWidth: 620 }}>
          Lumi cross-references your last 90 days of decisions and the MENA market dialect.
          Verdict is locked, audit-logged, and ready to execute against the Meta Graph API.
        </p>
      </header>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); if (stage === 'idle') setStage('dragging'); }}
        onDragLeave={() => { if (stage === 'dragging') setStage('idle'); }}
        onDrop={(e) => { e.preventDefault(); startUpload(); }}
        style={{
          border: stage === 'dragging' ? '2px solid var(--c-gold)' : '2px dashed var(--c-surface-border-strong)',
          background: stage === 'dragging' ? 'rgba(246,201,69,0.06)' : stage === 'parsed' ? 'var(--c-surface-card)' : 'var(--c-surface-elevated)',
          borderRadius: 18,
          padding: stage === 'parsed' ? '24px' : '40px 32px',
          transition: 'all 220ms',
          marginBottom: 24,
        }}
      >
        {stage === 'idle' || stage === 'dragging' ? (
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                width: 64, height: 64, borderRadius: 16, margin: '0 auto 18px',
                background: 'rgba(246,201,69,0.10)',
                color: 'var(--c-gold-deep)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1px solid rgba(246,201,69,0.25)',
              }}
            >
              <Icons.Upload style={{ fontSize: 28 }} />
            </div>
            <div className="font-display" style={{ fontSize: 18, fontWeight: 600, color: 'var(--c-text-base)', marginBottom: 6 }}>
              Drop your Meta Ads export here
            </div>
            <p style={{ fontSize: 13, color: 'var(--c-text-muted)', margin: '0 auto 18px', maxWidth: 380 }}>
              CSV from Ads Manager. We auto-detect dialect (EGP, SAR, AED) and BOM headers.
            </p>
            <button className="btn-gold" onClick={startUpload}>
              <Icons.FileText style={{ fontSize: 14 }} />
              Use demo file: {featured.file}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', marginTop: 16, fontSize: 11, color: 'var(--c-text-subtle)' }} className="font-mono">
              <span>or</span>
              <button className="btn-ghost" style={{ padding: '6px 14px', fontSize: 12 }}>
                <Icons.Wifi style={{ fontSize: 12 }} />
                Pull from Meta API
              </button>
            </div>
          </div>
        ) : stage === 'uploading' ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              <Icons.FileText style={{ fontSize: 24, color: 'var(--c-gold-deep)' }} />
              <div style={{ flex: 1 }}>
                <div className="font-display" style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text-base)' }}>{featured.file}</div>
                <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)', marginTop: 2 }}>{featured.fileSize} · CSV · uploading…</div>
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text-base)' }}>{Math.floor(progress)}%</div>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: 'var(--c-surface-border)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: 'var(--c-gold)', transition: 'width 80ms linear' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 18 }}>
              {['Parsing header','Detecting BOM','Resolving dialect','Validating rows'].map((t, i) => {
                const done = progress > (i + 1) * 25 - 12;
                return (
                  <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: done ? 'var(--c-scale-text)' : 'var(--c-text-subtle)' }}>
                    {done ? <Icons.Check style={{ fontSize: 12 }} /> : <span style={{ width: 8, height: 8, borderRadius: '50%', border: '1px solid currentColor', display: 'inline-block' }} />}
                    <span className="font-mono">{t}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <ParsedSummary featured={featured} workspace={workspace} />
        )}
      </div>

      {stage === 'parsed' && (
        <>
          {/* Target campaign + objective select */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 24 }}>
            <SelectCard label="Target campaign" value={featured.campaign.name} sub={`${featured.campaign.adset} · ${featured.campaign.audience}`} />
            <SelectCard label="Decision objective" value="Maximize ROAS, minimize bleed" sub="Default · adjust in Settings" />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <button className="btn-ghost" onClick={onCancel}>
              <Icons.ChevronLeft style={{ fontSize: 14 }} />
              Cancel
            </button>
            <button className="btn-gold" onClick={onAnalyze} style={{ padding: '14px 28px', fontSize: 15 }}>
              <Icons.Zap style={{ fontSize: 16 }} />
              Run intelligence scan
              <Icons.ArrowRight style={{ fontSize: 16 }} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ParsedSummary({ featured, workspace }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--c-scale-bg)', color: 'var(--c-scale-text)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icons.Check style={{ fontSize: 18 }} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="font-display" style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text-base)' }}>{featured.file}</div>
          <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)', marginTop: 2 }}>
            {featured.fileSize} · {featured.rows} rows · {featured.dateRange} · {workspace.currency}
          </div>
        </div>
        <button className="btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }}>
          <Icons.X style={{ fontSize: 12 }} />
          Replace
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <StatBlock label="Rows parsed" value={featured.rows.toString()} />
        <StatBlock label="Campaigns" value="3" sub="1 flagged" />
        <StatBlock label="Date range" value="30 days" sub={featured.dateRange.split(' – ').pop()} />
        <StatBlock label="Currency" value={workspace.currency} sub="auto-detected" />
      </div>
    </div>
  );
}

function StatBlock({ label, value, sub }) {
  return (
    <div style={{ padding: 12, background: 'var(--c-surface-elevated)', borderRadius: 10 }}>
      <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</div>
      <div className="font-mono tabular-nums" style={{ fontSize: 16, fontWeight: 700, color: 'var(--c-text-base)', marginTop: 4 }}>{value}</div>
      {sub && <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-subtle)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function SelectCard({ label, value, sub }) {
  return (
    <div style={{ padding: 16, background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
        <div className="font-display" style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text-base)' }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 2 }}>{sub}</div>}
      </div>
      <Icons.ChevronDown style={{ fontSize: 16, color: 'var(--c-text-muted)' }} />
    </div>
  );
}

export function Breadcrumb({ crumbs }) {
  return (
    <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
      {crumbs.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <Icons.ChevronRight style={{ fontSize: 10 }} />}
          <span
            onClick={c.onClick}
            style={{
              cursor: c.onClick ? 'pointer' : 'default',
              color: c.active ? 'var(--c-text-base)' : 'var(--c-text-muted)',
              fontWeight: c.active ? 600 : 400,
            }}
          >
            {c.label}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}


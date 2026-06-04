// ============================================================
// Marcom AI — Create-workspace modal
// ============================================================
// Captures a custom workspace and returns it via onCreate.
// Schema matches DEMO_DATA.WORKSPACES entries so the app can
// switch into it seamlessly.
// ============================================================

import { Icons } from './icons.jsx';

const CW_MARKETS = [
  { id: 'eg', label: 'Egypt',        currency: 'EGP', cities: ['Cairo','Alexandria','Giza','Other'] },
  { id: 'sa', label: 'Saudi Arabia', currency: 'SAR', cities: ['Riyadh','Jeddah','Dammam','Mecca','Other'] },
  { id: 'ae', label: 'UAE',          currency: 'AED', cities: ['Dubai','Abu Dhabi','Sharjah','Other'] },
  { id: 'kw', label: 'Kuwait',       currency: 'KWD', cities: ['Kuwait City','Other'] },
  { id: 'jo', label: 'Jordan',       currency: 'JOD', cities: ['Amman','Other'] },
  { id: 'ma', label: 'Morocco',      currency: 'MAD', cities: ['Casablanca','Rabat','Other'] },
];
const CW_CHANNELS = ['Meta','TikTok','Google','Snap','LinkedIn'];
const CW_TIERS = [
  { id: 't1', label: 'Under 50k / mo'    },
  { id: 't2', label: '50k – 250k / mo'   },
  { id: 't3', label: '250k – 1M / mo'    },
  { id: 't4', label: '1M+ / mo'          },
];

export function CreateWorkspaceModal({ onClose, onCreate }) {
  const [step, setStep] = React.useState(0);
  const [data, setData] = React.useState({
    name: '',
    market: 'eg',
    city: 'Cairo',
    tag: '',
    channels: { Meta: true },
    currency: 'EGP',
    spendTier: 't2',
  });
  const update = (p) => setData((d) => ({ ...d, ...p }));

  // Auto-update city + currency when market changes
  React.useEffect(() => {
    const m = CW_MARKETS.find((x) => x.id === data.market);
    if (!m) return;
    const patch = {};
    if (m.currency !== data.currency) patch.currency = m.currency;
    if (!m.cities.includes(data.city)) patch.city = m.cities[0];
    if (Object.keys(patch).length) setData((d) => ({ ...d, ...patch }));
  }, [data.market]);

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const market = CW_MARKETS.find((m) => m.id === data.market) || CW_MARKETS[0];
  const channelList = Object.entries(data.channels).filter(([, v]) => v).map(([k]) => k);

  const canAdvance =
    (step === 0 && data.name.trim().length >= 2) ||
    (step === 1 && channelList.length > 0) ||
    (step === 2);

  const finish = () => {
    const initials = data.name.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'WS';
    const tier = CW_TIERS.find((t) => t.id === data.spendTier);
    const ws = {
      id: `custom-${Date.now()}`,
      custom: true,
      name: data.name.trim(),
      tag: data.tag.trim() || `${data.city} · ${market.label}`,
      initials,
      market: market.label,
      currency: data.currency,
      currencySym: data.currency,
      spendTier: `${data.currency} ${tier?.label || ''}`,
      channels: channelList,
      sessions: [],
    };
    onCreate(ws);
  };

  return (
    <>
      {/* backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 99,
          background: 'rgba(15,15,20,0.45)',
          backdropFilter: 'blur(3px)',
          animation: 'fade-in 200ms ease-out both',
        }}
      />

      <div
        style={{
          position: 'fixed',
          top: '8%', left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 100,
          width: 640,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: '84vh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--c-surface-card)',
          border: '1px solid var(--c-surface-border)',
          borderRadius: 18,
          boxShadow: 'var(--sh-modal)',
          overflow: 'hidden',
          animation: 'slide-up 300ms cubic-bezier(0.16,1,0.3,1) both',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--c-surface-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, var(--c-gold), var(--c-gold-deep))', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--sh-gold-glow)' }}>
              <Icons.Plus style={{ fontSize: 16, color: 'var(--c-on-gold)' }} />
            </div>
            <div>
              <div className="font-display" style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-text-base)' }}>Create workspace</div>
              <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)' }}>Step {step + 1} of 3</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', padding: 6, color: 'var(--c-text-muted)', cursor: 'pointer', display: 'flex' }}>
            <Icons.X style={{ fontSize: 16 }} aria-hidden="true" />
          </button>
        </div>

        {/* Progress */}
        <div style={{ display: 'flex', gap: 4, padding: '0 20px', marginTop: 12 }}>
          {[0,1,2].map((i) => (
            <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= step ? 'var(--c-gold)' : 'var(--c-surface-border)', transition: 'background 240ms' }} />
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
          {step === 0 && <CWStepIdentity data={data} update={update} market={market} />}
          {step === 1 && <CWStepChannels data={data} update={update} market={market} />}
          {step === 2 && <CWStepReview data={data} market={market} channelList={channelList} />}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderTop: '1px solid var(--c-surface-border)', background: 'var(--c-surface-elevated)' }}>
          <button
            onClick={step === 0 ? onClose : () => setStep((s) => s - 1)}
            className="btn-ghost"
            style={{ padding: '8px 14px', fontSize: 12 }}
          >
            {step === 0 ? 'Cancel' : (<><Icons.ChevronLeft style={{ fontSize: 12 }} />Back</>)}
          </button>
          <button
            onClick={() => step === 2 ? finish() : setStep((s) => s + 1)}
            disabled={!canAdvance}
            className="btn-gold"
            style={{ padding: '10px 18px', fontSize: 13, opacity: canAdvance ? 1 : 0.5, cursor: canAdvance ? 'pointer' : 'not-allowed' }}
          >
            {step === 2 ? <><Icons.Check style={{ fontSize: 13 }} />Create workspace</> : <>Continue<Icons.ArrowRight style={{ fontSize: 13 }} /></>}
          </button>
        </div>
      </div>
    </>
  );
}

// ── Step components ─────────────────────────────────────────
function CWStepIdentity({ data, update, market }) {
  return (
    <div>
      <h2 className="font-display" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0, color: 'var(--c-text-base)' }}>Identity</h2>
      <p style={{ marginTop: 6, fontSize: 13, color: 'var(--c-text-soft)' }}>Brand name + market + city. Lumi tunes geo signals to this.</p>

      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <CWField label="Brand name" hint="The company or DTC brand">
          <input
            type="text"
            value={data.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="e.g. Karim Foods"
            autoFocus
            style={CW_INPUT}
          />
        </CWField>

        <CWField label="Primary market">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {CW_MARKETS.map((m) => (
              <button key={m.id} type="button" onClick={() => update({ market: m.id })} style={CW_TILE(data.market === m.id)}>
                <div className="font-display" style={{ fontSize: 12, fontWeight: 600 }}>{m.label}</div>
                <div className="font-mono" style={{ fontSize: 9, color: 'var(--c-text-muted)', marginTop: 2 }}>{m.currency}</div>
              </button>
            ))}
          </div>
        </CWField>

        <CWField label="Home city">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {market.cities.map((c) => (
              <button key={c} type="button" onClick={() => update({ city: c })} className="font-display" style={CW_CHIP(data.city === c)}>{c}</button>
            ))}
          </div>
        </CWField>

        <CWField label="Tag" hint="Appears under the brand name" optional>
          <input
            type="text"
            value={data.tag}
            onChange={(e) => update({ tag: e.target.value })}
            placeholder={`${data.city} · Modest fashion`}
            style={CW_INPUT}
          />
        </CWField>
      </div>
    </div>
  );
}

function CWStepChannels({ data, update, market }) {
  const toggle = (c) => update({ channels: { ...data.channels, [c]: !data.channels[c] } });
  return (
    <div>
      <h2 className="font-display" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0, color: 'var(--c-text-base)' }}>Channels & spend</h2>
      <p style={{ marginTop: 6, fontSize: 13, color: 'var(--c-text-soft)' }}>Pick the ad channels in play, set spend tier and reporting currency.</p>

      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <CWField label="Ad channels">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {CW_CHANNELS.map((c) => {
              const on = !!data.channels[c];
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggle(c)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px',
                    background: on ? 'rgba(246,201,69,0.06)' : 'var(--c-surface-card)',
                    border: `1px solid ${on ? 'rgba(246,201,69,0.55)' : 'var(--c-surface-border)'}`,
                    borderRadius: 10, cursor: 'pointer', textAlign: 'left', transition: 'all 150ms',
                  }}
                >
                  <span style={{
                    width: 18, height: 18, borderRadius: 4,
                    border: `2px solid ${on ? 'var(--c-gold-deep)' : 'var(--c-surface-border-strong)'}`,
                    background: on ? 'var(--c-gold)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {on && <Icons.Check style={{ fontSize: 11, color: 'var(--c-text-base)', strokeWidth: 3 }} />}
                  </span>
                  <span className="font-display" style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-base)' }}>{c}</span>
                </button>
              );
            })}
          </div>
        </CWField>

        <CWField label="Spend tier">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
            {CW_TIERS.map((t) => (
              <button key={t.id} type="button" onClick={() => update({ spendTier: t.id })} style={CW_TILE(data.spendTier === t.id)}>
                <div className="font-display" style={{ fontSize: 12, fontWeight: 600 }}>{market.currency} {t.label}</div>
              </button>
            ))}
          </div>
        </CWField>

        <CWField label="Reporting currency">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
            {['EGP','SAR','AED','KWD','JOD','USD'].map((cur) => (
              <button
                key={cur} type="button" onClick={() => update({ currency: cur })} className="font-mono"
                style={{
                  padding: '7px 0',
                  background: data.currency === cur ? 'var(--c-gold)' : 'var(--c-surface-card)',
                  color: data.currency === cur ? 'var(--c-text-base)' : 'var(--c-text-soft)',
                  border: `1px solid ${data.currency === cur ? 'var(--c-gold-deep)' : 'var(--c-surface-border)'}`,
                  borderRadius: 7, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', cursor: 'pointer',
                }}
              >{cur}</button>
            ))}
          </div>
        </CWField>
      </div>
    </div>
  );
}

function CWStepReview({ data, market, channelList }) {
  const initials = (data.name || 'WS').split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'WS';
  const tier = CW_TIERS.find((t) => t.id === data.spendTier);
  return (
    <div>
      <h2 className="font-display" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0, color: 'var(--c-text-base)' }}>Review</h2>
      <p style={{ marginTop: 6, fontSize: 13, color: 'var(--c-text-soft)' }}>Lumi will switch into this workspace as soon as you create it.</p>

      <div style={{ marginTop: 20, padding: 16, background: 'var(--c-surface-elevated)', border: '1px solid var(--c-surface-border)', borderRadius: 14 }}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 9, background: 'linear-gradient(135deg, var(--c-gold), var(--c-gold-deep))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: 'var(--sh-gold-glow)' }}>
            <span className="font-display" style={{ fontWeight: 700, fontSize: 14, color: 'var(--c-on-gold)' }}>{initials}</span>
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="font-display" style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-text-base)' }}>{data.name || 'Untitled'}</div>
            <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 2 }}>{data.tag || `${data.city} · ${market.label}`}</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <CWReviewRow label="Market"   value={`${market.label} · ${data.city}`} />
          <CWReviewRow label="Currency" value={data.currency} />
          <CWReviewRow label="Spend"    value={tier?.label || '—'} />
          <CWReviewRow label="Channels" value={channelList.join(' · ')} />
        </div>
      </div>

      <div style={{ marginTop: 16, padding: 14, borderRadius: 12, background: 'rgba(246,201,69,0.06)', border: '1px solid rgba(246,201,69,0.25)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Icons.Sparkles style={{ fontSize: 18, color: 'var(--c-gold-deep)', flexShrink: 0 }} />
        <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-soft)' }}>
          Empty workspace · 0 campaigns · 0 decisions. Upload your first CSV to populate the radar.
        </div>
      </div>
    </div>
  );
}

function CWReviewRow({ label, value }) {
  return (
    <div style={{ padding: '10px 12px', background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 8 }}>
      <div className="font-mono" style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>{label}</div>
      <div className="font-display" style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text-base)', marginTop: 2 }}>{value || '—'}</div>
    </div>
  );
}

function CWField({ label, hint, optional, children }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <label className="font-display" style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text-base)' }}>{label}</label>
        {optional && <span className="font-mono" style={{ fontSize: 9, color: 'var(--c-text-subtle)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Optional</span>}
        {hint && <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const CW_INPUT = {
  width: '100%', padding: '10px 12px',
  fontSize: 13, fontFamily: 'var(--f-body)',
  color: 'var(--c-text-base)',
  background: 'var(--c-surface-card)',
  border: '1px solid var(--c-surface-border)',
  borderRadius: 9, outline: 'none',
};
const CW_TILE = (on) => ({
  padding: '9px 11px',
  borderRadius: 9,
  background: on ? 'rgba(246,201,69,0.08)' : 'var(--c-surface-card)',
  border: `1px solid ${on ? 'rgba(246,201,69,0.55)' : 'var(--c-surface-border)'}`,
  cursor: 'pointer', textAlign: 'left', transition: 'all 150ms',
});
const CW_CHIP = (on) => ({
  padding: '5px 10px',
  background: on ? 'var(--c-gold)' : 'var(--c-surface-card)',
  color: on ? 'var(--c-text-base)' : 'var(--c-text-soft)',
  border: `1px solid ${on ? 'var(--c-gold-deep)' : 'var(--c-surface-border)'}`,
  borderRadius: 999, fontSize: 11, fontWeight: on ? 600 : 500,
  cursor: 'pointer', transition: 'all 150ms',
});


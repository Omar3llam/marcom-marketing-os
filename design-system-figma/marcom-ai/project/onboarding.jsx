// ============================================================
// Marcom AI — Onboarding wizard (v2 — expanded context)
// ============================================================

import { Icons } from './icons.jsx';

const APP_URL      = './MARCOM%20Demo.html';
const LANDING_URL  = './MARCOM%20Landing.html';
const STORAGE_KEY  = 'marcom-onboarding-v2';

// ── Reference data ───────────────────────────────────────────
const MARKETS = [
  { id: 'eg', label: 'Egypt',        currency: 'EGP', cities: ['Cairo','Alexandria','Giza','Mansoura','Other'] },
  { id: 'sa', label: 'Saudi Arabia', currency: 'SAR', cities: ['Riyadh','Jeddah','Dammam','Mecca','Medina','Other'] },
  { id: 'ae', label: 'UAE',          currency: 'AED', cities: ['Dubai','Abu Dhabi','Sharjah','Other'] },
  { id: 'kw', label: 'Kuwait',       currency: 'KWD', cities: ['Kuwait City','Hawalli','Other'] },
  { id: 'jo', label: 'Jordan',       currency: 'JOD', cities: ['Amman','Zarqa','Irbid','Other'] },
  { id: 'ma', label: 'Morocco',      currency: 'MAD', cities: ['Casablanca','Rabat','Marrakech','Fes','Other'] },
];

const AGE_BANDS = [
  { id: '18-24', label: '18 – 24' },
  { id: '25-34', label: '25 – 34' },
  { id: '35-44', label: '35 – 44' },
  { id: '45-54', label: '45 – 54' },
  { id: '55+',   label: '55+' },
];
const GENDERS = [
  { id: 'all',    label: 'All' },
  { id: 'female', label: 'Female-leaning' },
  { id: 'male',   label: 'Male-leaning' },
];
const INTERESTS = ['Fashion','Beauty','Tech','Food & dining','Travel','Fitness','Home','Auto','Finance','Gaming','Family','Lifestyle','B2B'];

const LANGUAGES = [
  { id: 'ar',     label: 'Arabic' },
  { id: 'en',     label: 'English' },
  { id: 'both',   label: 'Bilingual' },
];
const DIALECTS = [
  { id: 'egy',   label: 'Egyptian',         sub: 'Masri'    },
  { id: 'gulf',  label: 'Gulf',             sub: 'Khaleeji' },
  { id: 'lev',   label: 'Levantine',        sub: 'Shami'    },
  { id: 'mag',   label: 'Maghrebi',         sub: 'Darija'   },
  { id: 'msa',   label: 'Modern Standard',  sub: 'Fusha'    },
  { id: 'none',  label: 'English only',     sub: '—'        },
];
const TONES = [
  { id: 'playful',  label: 'Playful & casual',    sub: 'Approachable, witty, lower-case-friendly' },
  { id: 'premium',  label: 'Premium & refined',   sub: 'Editorial, considered, restrained' },
  { id: 'trusted',  label: 'Trusted authority',   sub: 'Direct, evidence-led, expert' },
  { id: 'bold',     label: 'Bold & rebellious',   sub: 'Punchy, provocative, opinionated' },
  { id: 'warm',     label: 'Warm & familial',     sub: 'Personal, story-led, MENA-rooted' },
];

const CHANNELS = [
  { id: 'meta',     label: 'Meta',     sub: 'Facebook + Instagram', primary: true },
  { id: 'tiktok',   label: 'TikTok',   sub: 'TikTok Ads Manager' },
  { id: 'google',   label: 'Google',   sub: 'Ads + PMax' },
  { id: 'snap',     label: 'Snap',     sub: 'Snapchat Ads' },
  { id: 'linkedin', label: 'LinkedIn', sub: 'B2B / Sponsored' },
];

const SPEND_TIERS = [
  { id: 't1', label: 'Under 50k / mo',   bar: 0.18 },
  { id: 't2', label: '50k – 250k / mo',  bar: 0.40 },
  { id: 't3', label: '250k – 1M / mo',   bar: 0.68 },
  { id: 't4', label: '1M+ / mo',         bar: 1.00 },
];

const SCORE_PLATFORMS = [
  { id: 'meta_ads',    label: 'Meta ad copy' },
  { id: 'tiktok_ads',  label: 'TikTok ad copy' },
  { id: 'ig_caption',  label: 'IG captions' },
  { id: 'google_hl',   label: 'Google headlines' },
  { id: 'email',       label: 'Email subject + body' },
  { id: 'landing',     label: 'Landing page copy' },
];

const CALENDAR_PLATFORMS = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok',    label: 'TikTok' },
  { id: 'snap',      label: 'Snap' },
  { id: 'x',         label: 'X / Twitter' },
  { id: 'linkedin',  label: 'LinkedIn' },
  { id: 'youtube',   label: 'YouTube Shorts' },
];

const CADENCES = [
  { id: 'low',  label: '3 – 5 / week',   sub: 'Quality-first' },
  { id: 'mid',  label: '5 – 10 / week',  sub: 'Balanced' },
  { id: 'high', label: '10 – 20 / week', sub: 'Always-on' },
  { id: 'max',  label: '20+ / week',     sub: 'Multi-creator' },
];

const OBJECTIVES = [
  { id: 'roas',        label: 'Maximize ROAS, minimize bleed',  sub: 'Default for e-commerce + DTC',           Icon: Icons.TrendingUp },
  { id: 'conversions', label: 'Maximize new conversions',        sub: 'Volume-focused. Tolerates higher CPA.',   Icon: Icons.Target },
  { id: 'ltv',         label: 'Maximize lifetime value',         sub: 'Lumi factors in repeat-purchase signal.', Icon: Icons.Layers },
  { id: 'custom',      label: 'Custom objective',                sub: 'Describe what success looks like.',        Icon: Icons.Brain },
];

const DEFAULTS = {
  name: '',
  market: 'eg',
  city: 'Cairo',
  tag: '',
  ages: { '25-34': true, '35-44': true },
  gender: 'all',
  interests: { Fashion: true },
  language: 'both',
  dialect: 'egy',
  tone: 'warm',
  channels: { meta: true },
  spendTier: 't2',
  currency: 'EGP',
  objective: 'roas',
  customObjective: '',
  plan: 'pro',
  billing: 'monthly',
};

const STEPS = [
  { key: 'welcome',   label: 'Welcome' },
  { key: 'identity',  label: 'Workspace' },
  { key: 'audience',  label: 'Audience' },
  { key: 'voice',     label: 'Brand voice' },
  { key: 'channels',  label: 'Ad channels' },
  { key: 'spend',     label: 'Spend tier' },
  { key: 'objective', label: 'Objective' },
  { key: 'plan',      label: 'Plan' },
  { key: 'review',    label: 'Review' },
];

// ══════════════════════════════════════════════════════════════
// ROOT
// ══════════════════════════════════════════════════════════════
export function Onboarding() {
  const [step, setStep] = React.useState(0);
  const [data, setData] = React.useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (s) return { ...DEFAULTS, ...s };
    } catch (_) {}
    return DEFAULTS;
  });

  React.useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) {} }, [data]);

  // Auto-sync currency + city when market changes
  React.useEffect(() => {
    const m = MARKETS.find((x) => x.id === data.market);
    if (!m) return;
    const patch = {};
    if (m.currency !== data.currency) patch.currency = m.currency;
    if (!m.cities.includes(data.city)) patch.city = m.cities[0];
    if (Object.keys(patch).length) setData((d) => ({ ...d, ...patch }));
  }, [data.market]);

  const update = (patch) => setData((d) => ({ ...d, ...patch }));
  const total = STEPS.length;

  const interestsCount = Object.values(data.interests).filter(Boolean).length;
  const agesCount = Object.values(data.ages).filter(Boolean).length;
  const channelsCount = Object.values(data.channels).filter(Boolean).length;

  const canAdvance = (() => {
    switch (step) {
      case 0: return true;
      case 1: return data.name.trim().length >= 2;
      case 2: return agesCount > 0 && interestsCount > 0;
      case 3: return !!data.language && !!data.dialect && !!data.tone;
      case 4: return channelsCount > 0;
      case 5: return true;
      case 6: return data.objective !== 'custom' || data.customObjective.trim().length >= 4;
      case 7: return !!data.plan;
      case 8: return true;
      default: return true;
    }
  })();

  const next = () => {
    if (step >= total - 1) { window.location.href = APP_URL; return; }
    if (canAdvance) setStep((s) => Math.min(total - 1, s + 1));
  };
  const prev = () => setStep((s) => Math.max(0, s - 1));

  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft' && !['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) prev();
      else if (e.key === 'ArrowRight' && !['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, canAdvance, data]);

  const market = MARKETS.find((m) => m.id === data.market) || MARKETS[0];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--c-surface-light)', display: 'flex', flexDirection: 'column' }}>
      <TopBar />
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 380px', gap: 0 }}>
        <main className="onb-main" style={{ display: 'flex', flexDirection: 'column', padding: '36px 56px 24px', maxWidth: 940, width: '100%', margin: '0 auto' }}>
          <ProgressBar step={step} total={total} />
          <div key={step} className="anim-fade-in" style={{ flex: 1, marginTop: 28 }}>
            {step === 0 && <WelcomeStep />}
            {step === 1 && <IdentityStep data={data} update={update} market={market} />}
            {step === 2 && <AudienceStep data={data} update={update} />}
            {step === 3 && <VoiceStep data={data} update={update} />}
            {step === 4 && <ChannelsStep data={data} update={update} />}
            {step === 5 && <SpendStep data={data} update={update} market={market} />}
            {step === 6 && <ObjectiveStep data={data} update={update} />}
            {step === 7 && <PlanStep data={data} update={update} />}
            {step === 8 && <ReviewStep data={data} market={market} />}
          </div>
          <Footer step={step} total={total} canAdvance={canAdvance} onPrev={prev} onNext={next} />
        </main>
        <aside className="desktop-only" style={{ background: 'var(--c-surface-card)', borderLeft: '1px solid var(--c-surface-border)', padding: '36px 28px' }}>
          <PreviewPane data={data} market={market} step={step} />
        </aside>
      </div>
    </div>
  );
}

// ── Top bar ──────────────────────────────────────────────────
function TopBar() {
  return (
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 32px', borderBottom: '1px solid var(--c-surface-border)', background: 'var(--c-surface-light)' }}>
      <a href={LANDING_URL} style={{ textDecoration: 'none', color: 'var(--c-text-base)', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        <span style={{ position: 'relative', width: 22, height: 22 }}>
          <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1.5px solid var(--c-gold-deep)' }} />
          <span style={{ position: 'absolute', top: '50%', left: '50%', width: 8, height: 8, transform: 'translate(-50%, -50%)', background: 'var(--c-gold)', borderRadius: '50%', boxShadow: '0 0 6px var(--c-gold)' }} />
        </span>
        <span className="font-display" style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.02em' }}>Marcom<span style={{ color: 'var(--c-gold-deep)' }}>AI</span></span>
      </a>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <a href={LANDING_URL} className="font-display" style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text-muted)', textDecoration: 'none' }}>← Back to home</a>
        <a href={APP_URL} className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)', textDecoration: 'none', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Skip for now</a>
      </div>
    </header>
  );
}

// ── Progress bar ─────────────────────────────────────────────
function ProgressBar({ step, total }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <span className="font-mono" style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>
          Step {step + 1} of {total} · {STEPS[step].label}
        </span>
        <span className="font-mono tabular-nums" style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>
          {Math.round(((step + 1) / total) * 100)}%
        </span>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {STEPS.map((s, i) => (
          <div key={s.key} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= step ? 'var(--c-gold)' : 'var(--c-surface-border)', transition: 'background 280ms cubic-bezier(0.16,1,0.3,1)', boxShadow: i === step ? '0 0 8px rgba(246,201,69,0.5)' : 'none' }} />
        ))}
      </div>
    </div>
  );
}

// ── Footer nav ───────────────────────────────────────────────
function Footer({ step, total, canAdvance, onPrev, onNext }) {
  const isLast = step === total - 1;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 28, paddingTop: 22, borderTop: '1px solid var(--c-surface-border)' }}>
      <button onClick={onPrev} disabled={step === 0} className="btn-ghost" style={{ opacity: step === 0 ? 0.4 : 1, cursor: step === 0 ? 'not-allowed' : 'pointer' }}>
        <Icons.ChevronLeft style={{ fontSize: 14 }} />
        Back
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-subtle)', letterSpacing: '0.06em' }}>
          {isLast ? 'Press ⌘↵ to launch' : 'Press ⌘↵ or → to continue'}
        </span>
        <button onClick={onNext} disabled={!canAdvance} className="btn-gold" style={{ padding: '12px 22px', fontSize: 14, opacity: canAdvance ? 1 : 0.5, cursor: canAdvance ? 'pointer' : 'not-allowed' }}>
          {isLast ? (<><Icons.Zap style={{ fontSize: 14 }} />Launch your war room<Icons.ArrowRight style={{ fontSize: 14 }} /></>) : (<>Continue<Icons.ArrowRight style={{ fontSize: 14 }} /></>)}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// STEPS
// ══════════════════════════════════════════════════════════════
function WelcomeStep() {
  return (
    <div>
      <Eyebrow>Welcome to Marcom AI</Eyebrow>
      <BigHeader>Let's get Lumi watching your campaigns.</BigHeader>
      <Lede>Nine quick questions — about two minutes. Once you're done, Lumi knows your market, your audience, your voice, and what success looks like. Every verdict, every piece of content scored, every social post planned will be grounded in that context.</Lede>
      <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {[
          { Icon: Icons.Layout, title: 'Identity',  body: 'Who you are, where you operate.' },
          { Icon: Icons.Eye,    title: 'Audience',  body: 'Who you sell to.' },
          { Icon: Icons.Globe,  title: 'Voice',     body: 'Language, dialect, tone.' },
          { Icon: Icons.Zap,    title: 'Toolkit',   body: 'Channels, content, objective.' },
        ].map((c) => (
          <div key={c.title} style={{ padding: 16, background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(246,201,69,0.10)', color: 'var(--c-gold-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
              <c.Icon style={{ fontSize: 16 }} />
            </div>
            <div className="font-display" style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text-base)' }}>{c.title}</div>
            <div style={{ marginTop: 3, fontSize: 11, color: 'var(--c-text-soft)', lineHeight: 1.45 }}>{c.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IdentityStep({ data, update, market }) {
  return (
    <div>
      <Eyebrow>Step 2 · Workspace identity</Eyebrow>
      <BigHeader>Who is Lumi watching for?</BigHeader>
      <Lede>This becomes your workspace HQ — the brand, market, and home city Lumi anchors every decision against.</Lede>
      <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 600 }}>
        <Field label="Brand name" hint="Your company or DTC brand">
          <input type="text" value={data.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. Maison Salam" autoFocus style={inputStyle} />
        </Field>
        <Field label="Primary market" hint="Where most of your spend lives">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {MARKETS.map((m) => (
              <button key={m.id} type="button" onClick={() => update({ market: m.id })} style={tileBtn(data.market === m.id)}>
                <div className="font-display" style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-base)' }}>{m.label}</div>
                <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', marginTop: 2 }}>{m.currency}</div>
              </button>
            ))}
          </div>
        </Field>
        <Field label={`Home city in ${market.label}`} hint="Lumi tunes geo-concentration signals to this">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {market.cities.map((c) => (
              <button key={c} type="button" onClick={() => update({ city: c })} className="font-display" style={chipBtn(data.city === c)}>{c}</button>
            ))}
          </div>
        </Field>
        <Field label="Short tag" hint="Appears under the brand name in the sidebar" optional>
          <input type="text" value={data.tag} onChange={(e) => update({ tag: e.target.value })} placeholder={`${data.city} · Modest fashion`} style={inputStyle} />
        </Field>
      </div>
    </div>
  );
}

function AudienceStep({ data, update }) {
  const toggleAge = (id) => update({ ages: { ...data.ages, [id]: !data.ages[id] } });
  const toggleInt = (id) => update({ interests: { ...data.interests, [id]: !data.interests[id] } });
  return (
    <div>
      <Eyebrow>Step 3 · Target audience</Eyebrow>
      <BigHeader>Who are you selling to?</BigHeader>
      <Lede>Pick the buyer Lumi should optimize for. Multiple age bands and interests are fine — Lumi treats them as overlapping signals, not a hard filter.</Lede>
      <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 720 }}>
        <Field label="Primary age bands" hint="Multi-select">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {AGE_BANDS.map((a) => (
              <button key={a.id} type="button" onClick={() => toggleAge(a.id)} className="font-mono" style={chipBtn(!!data.ages[a.id])}>{a.label}</button>
            ))}
          </div>
        </Field>
        <Field label="Gender focus">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {GENDERS.map((g) => (
              <button key={g.id} type="button" onClick={() => update({ gender: g.id })} style={tileBtn(data.gender === g.id)}>
                <div className="font-display" style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-base)' }}>{g.label}</div>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Interest themes" hint="Pick 1–4">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {INTERESTS.map((i) => (
              <button key={i} type="button" onClick={() => toggleInt(i)} className="font-display" style={chipBtn(!!data.interests[i])}>{i}</button>
            ))}
          </div>
        </Field>
      </div>
    </div>
  );
}

function VoiceStep({ data, update }) {
  return (
    <div>
      <Eyebrow>Step 4 · Brand voice</Eyebrow>
      <BigHeader>How should Lumi sound when it speaks for you?</BigHeader>
      <Lede>Affects every piece of content Lumi scores, every social caption it drafts, every notification it writes. Pick the language mix, the dialect for Arabic copy, and a tone that matches your brand.</Lede>
      <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 720 }}>
        <Field label="Content language">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {LANGUAGES.map((l) => (
              <button key={l.id} type="button" onClick={() => update({ language: l.id })} style={tileBtn(data.language === l.id)}>
                <div className="font-display" style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-base)' }}>{l.label}</div>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Arabic dialect" hint={data.language === 'en' ? 'Not used — English only' : 'Lumi will write Arabic copy in this voice'}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, opacity: data.language === 'en' ? 0.4 : 1, pointerEvents: data.language === 'en' ? 'none' : 'auto' }}>
            {DIALECTS.map((d) => (
              <button key={d.id} type="button" onClick={() => update({ dialect: d.id })} style={tileBtn(data.dialect === d.id)}>
                <div className="font-display" style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-base)' }}>{d.label}</div>
                <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', marginTop: 2 }}>{d.sub}</div>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Brand tone">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(1, 1fr)', gap: 8 }}>
            {TONES.map((t) => (
              <button key={t.id} type="button" onClick={() => update({ tone: t.id })} style={{ ...tileBtn(data.tone === t.id), display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                <div className="font-display" style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-base)' }}>{t.label}</div>
                <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{t.sub}</div>
              </button>
            ))}
          </div>
        </Field>
      </div>
    </div>
  );
}

function ChannelsStep({ data, update }) {
  const toggle = (id) => update({ channels: { ...data.channels, [id]: !data.channels[id] } });
  const selected = Object.values(data.channels).filter(Boolean).length;
  return (
    <div>
      <Eyebrow>Step 5 · Ad channels</Eyebrow>
      <BigHeader>Where are you running paid?</BigHeader>
      <Lede>Pick everything in play. Lumi treats each channel separately for verdicts but cross-references signal between them.</Lede>
      <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640 }}>
        {CHANNELS.map((c) => {
          const on = !!data.channels[c.id];
          return (
            <button key={c.id} type="button" onClick={() => toggle(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 18px', background: on ? 'rgba(246,201,69,0.06)' : 'var(--c-surface-card)', border: `1px solid ${on ? 'rgba(246,201,69,0.55)' : 'var(--c-surface-border)'}`, borderRadius: 14, cursor: 'pointer', textAlign: 'left', transition: 'all 180ms' }}>
              <CheckBox on={on} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="font-display" style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-text-base)' }}>{c.label}</span>
                  {c.primary && <span className="font-mono" style={{ fontSize: 9, letterSpacing: '0.08em', padding: '2px 6px', borderRadius: 3, background: 'rgba(246,201,69,0.10)', color: 'var(--c-gold-deep)' }}>RECOMMENDED</span>}
                </div>
                <div style={{ marginTop: 2, fontSize: 11, color: 'var(--c-text-muted)' }}>{c.sub}</div>
              </div>
              {on && (
                <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-scale-text)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--c-scale)' }} />
                  Will connect on launch
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="font-mono" style={{ marginTop: 14, fontSize: 11, color: 'var(--c-text-muted)' }}>{selected} of {CHANNELS.length} selected · OAuth happens in the app.</div>
    </div>
  );
}

function SpendStep({ data, update, market }) {
  return (
    <div>
      <Eyebrow>Step 6 · Spend tier</Eyebrow>
      <BigHeader>Roughly how much do you spend a month?</BigHeader>
      <Lede>Tunes Lumi's bleed thresholds — a $100/day campaign and a $10k/day campaign aren't graded on the same scale.</Lede>
      <div style={{ marginTop: 28, maxWidth: 640 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {SPEND_TIERS.map((t, i) => {
            const on = data.spendTier === t.id;
            return (
              <button key={t.id} type="button" onClick={() => update({ spendTier: t.id })} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', background: on ? 'rgba(246,201,69,0.06)' : 'var(--c-surface-card)', border: `1px solid ${on ? 'rgba(246,201,69,0.55)' : 'var(--c-surface-border)'}`, borderRadius: 12, cursor: 'pointer', textAlign: 'left', transition: 'all 180ms' }}>
                <RadioDot on={on} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="font-display" style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-base)' }}>{market.currency} {t.label}</div>
                  <div style={{ marginTop: 5, height: 4, borderRadius: 2, background: 'var(--c-surface-elevated)', overflow: 'hidden', maxWidth: 320 }}>
                    <div style={{ width: `${t.bar * 100}%`, height: '100%', background: 'linear-gradient(90deg, var(--c-gold-deep), var(--c-gold))', borderRadius: 2 }} />
                  </div>
                </div>
                <span className="font-mono tabular-nums" style={{ fontSize: 10, color: 'var(--c-text-muted)' }}>Tier {i + 1}</span>
              </button>
            );
          })}
        </div>
        <Field label="Reporting currency" hint="Defaults to your market — change if you report in something else">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
            {['EGP','SAR','AED','KWD','JOD','USD'].map((cur) => (
              <button key={cur} type="button" onClick={() => update({ currency: cur })} className="font-mono" style={{ padding: '8px 0', background: data.currency === cur ? 'var(--c-gold)' : 'var(--c-surface-card)', color: data.currency === cur ? 'var(--c-text-base)' : 'var(--c-text-soft)', border: `1px solid ${data.currency === cur ? 'var(--c-gold-deep)' : 'var(--c-surface-border)'}`, borderRadius: 8, fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', cursor: 'pointer' }}>{cur}</button>
            ))}
          </div>
        </Field>
      </div>
    </div>
  );
}

function ContentToolsStep({ data, update }) {
  const toggleScore = (id) => update({ scorePlatforms: { ...data.scorePlatforms, [id]: !data.scorePlatforms[id] } });
  const toggleCal   = (id) => update({ calendarPlatforms: { ...data.calendarPlatforms, [id]: !data.calendarPlatforms[id] } });
  return (
    <div>
      <Eyebrow>Step 7 · Content tools</Eyebrow>
      <BigHeader>Set up Score Content + Social Calendar.</BigHeader>
      <Lede>These two modules unlock alongside the decision engine. Pick what they'll touch — Lumi pre-wires both with your voice and dialect from the previous step.</Lede>

      <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Score Content */}
        <ToolPanel
          tag="MODULE 03"
          tagColor="var(--c-hold)"
          title="Score Content"
          sub="Rate ad copy & captions against the MARCOM framework"
          Icon={Icons.ScanSearch}
        >
          <div className="section-label" style={{ marginBottom: 8 }}>Which surfaces?</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {SCORE_PLATFORMS.map((p) => (
              <button key={p.id} type="button" onClick={() => toggleScore(p.id)} className="font-display" style={chipBtn(!!data.scorePlatforms[p.id])}>{p.label}</button>
            ))}
          </div>
        </ToolPanel>

        {/* Social Calendar */}
        <ToolPanel
          tag="MODULE 04"
          tagColor="var(--c-stage-scaling)"
          title="Social Calendar"
          sub="4-week post plan with verdict-led prioritization"
          Icon={Icons.Calendar}
        >
          <div className="section-label" style={{ marginBottom: 8 }}>Platforms to plan</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {CALENDAR_PLATFORMS.map((p) => (
              <button key={p.id} type="button" onClick={() => toggleCal(p.id)} className="font-display" style={chipBtn(!!data.calendarPlatforms[p.id])}>{p.label}</button>
            ))}
          </div>
          <div className="section-label" style={{ marginBottom: 8 }}>Posting cadence</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
            {CADENCES.map((c) => (
              <button key={c.id} type="button" onClick={() => update({ cadence: c.id })} style={{ ...tileBtn(data.cadence === c.id), padding: '10px 12px' }}>
                <div className="font-display" style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text-base)' }}>{c.label}</div>
                <div className="font-mono" style={{ fontSize: 9, color: 'var(--c-text-muted)', marginTop: 2 }}>{c.sub}</div>
              </button>
            ))}
          </div>
        </ToolPanel>
      </div>

      <div style={{ marginTop: 16, padding: 14, borderRadius: 12, background: 'rgba(246,201,69,0.06)', border: '1px solid rgba(246,201,69,0.25)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Icons.Sparkles style={{ fontSize: 18, color: 'var(--c-gold-deep)' }} />
        <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-soft)' }}>
          Both modules will inherit your <strong style={{ color: 'var(--c-text-base)' }}>brand voice + dialect</strong> automatically.
        </div>
      </div>
    </div>
  );
}

function ToolPanel({ tag, tagColor, title, sub, Icon, children }) {
  return (
    <div style={{ background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 14, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span className="font-mono" style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', padding: '2px 6px', borderRadius: 3, background: `${tagColor}1a`, color: tagColor }}>{tag}</span>
        <Icon style={{ fontSize: 18, color: 'var(--c-text-muted)' }} />
      </div>
      <div className="font-display" style={{ fontSize: 16, fontWeight: 700, color: 'var(--c-text-base)' }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--c-text-muted)', marginTop: 4, marginBottom: 14 }}>{sub}</div>
      <div style={{ borderTop: '1px solid var(--c-surface-border)', paddingTop: 14 }}>{children}</div>
    </div>
  );
}

function ObjectiveStep({ data, update }) {
  return (
    <div>
      <Eyebrow>Step 7 · Decision objective</Eyebrow>
      <BigHeader>What does winning look like?</BigHeader>
      <Lede>Lumi optimizes verdicts against this objective. Change it anytime in Settings.</Lede>
      <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, maxWidth: 760 }}>
        {OBJECTIVES.map((o) => {
          const on = data.objective === o.id;
          return (
            <button key={o.id} type="button" onClick={() => update({ objective: o.id })} style={{ display: 'flex', gap: 14, padding: 18, background: on ? 'rgba(246,201,69,0.06)' : 'var(--c-surface-card)', border: `1px solid ${on ? 'rgba(246,201,69,0.55)' : 'var(--c-surface-border)'}`, borderRadius: 14, cursor: 'pointer', textAlign: 'left', transition: 'all 180ms' }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: on ? 'var(--c-gold)' : 'rgba(246,201,69,0.10)', color: on ? 'var(--c-text-base)' : 'var(--c-gold-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <o.Icon style={{ fontSize: 18 }} />
              </div>
              <div>
                <div className="font-display" style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text-base)' }}>{o.label}</div>
                <div style={{ marginTop: 3, fontSize: 11, color: 'var(--c-text-soft)', lineHeight: 1.5 }}>{o.sub}</div>
              </div>
            </button>
          );
        })}
      </div>
      {data.objective === 'custom' && (
        <div style={{ marginTop: 16, maxWidth: 760 }} className="anim-slide-up">
          <Field label="Describe your objective" hint="Lumi will incorporate this into its reasoning">
            <textarea value={data.customObjective} onChange={(e) => update({ customObjective: e.target.value })} placeholder="e.g. Maximize new customer acquisition under $80 CPA, even at lower ROAS." rows={3} style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }} autoFocus />
          </Field>
        </div>
      )}
    </div>
  );
}

// ── Plan step (NEW) ──────────────────────────────────────────
const ONB_PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    tag: 'For solo operators',
    prices:  { USD: 39,  EGP: 1800,  SAR: 149,  AED: 144, KWD: 12,  JOD: 28,  MAD: 390 },
    yearly:  { USD: 390, EGP: 18000, SAR: 1490, AED: 1440, KWD: 120, JOD: 280, MAD: 3900 },
    bullets: ['1 workspace', '20 verdicts / mo', 'Content Lab limited', 'Email alerts'],
  },
  {
    id: 'pro',
    name: 'Pro',
    tag: 'For media buyers + small teams',
    badge: 'Recommended',
    prices:  { USD: 149,  EGP: 6900,  SAR: 559,  AED: 548,  KWD: 46,  JOD: 106, MAD: 1490 },
    yearly:  { USD: 1490, EGP: 69000, SAR: 5590, AED: 5480, KWD: 460, JOD: 1060, MAD: 14900 },
    bullets: ['3 workspaces · all channels', 'Unlimited verdicts', 'Full Content Lab + Calendar', '90-day memory layer', 'Slack + WhatsApp alerts'],
  },
  {
    id: 'agency',
    name: 'Agency',
    tag: 'For agencies + holdcos',
    prices:  { USD: 499,  EGP: 22500, SAR: 1869, AED: 1832, KWD: 154, JOD: 354, MAD: 4990 },
    yearly:  { USD: 4990, EGP: 225000, SAR: 18690, AED: 18320, KWD: 1540, JOD: 3540, MAD: 49900 },
    bullets: ['Unlimited workspaces', 'Unlimited seats', 'White-label + custom domain', 'SSO + audit log', 'Custom Lumi fine-tuning'],
  },
];

function PlanStep({ data, update }) {
  const cur = data.currency || 'USD';
  const annual = data.billing === 'annual';
  const symBefore = cur === 'USD';

  return (
    <div>
      <Eyebrow>Step 8 · Choose your plan</Eyebrow>
      <BigHeader>Pick the plan that fits your operation.</BigHeader>
      <Lede>Pricing follows the currency you set in step 5. Annual saves about two months. You can change anytime in Settings.</Lede>

      {/* Billing toggle */}
      <div style={{ marginTop: 28, display: 'flex', alignItems: 'center', gap: 14 }}>
        <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Billing</span>
        <div style={{ display: 'inline-flex', padding: 3, background: 'var(--c-surface-elevated)', border: '1px solid var(--c-surface-border)', borderRadius: 999 }}>
          {['monthly', 'annual'].map((b) => (
            <button
              key={b}
              onClick={() => update({ billing: b })}
              className="font-display"
              style={{
                padding: '6px 14px',
                background: data.billing === b ? 'var(--c-surface-card)' : 'transparent',
                border: 'none',
                color: data.billing === b ? 'var(--c-text-base)' : 'var(--c-text-muted)',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: data.billing === b ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              {b === 'monthly' ? 'Monthly' : 'Annual'}
              {b === 'annual' && <span className="font-mono" style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: 'var(--c-gold)', color: 'var(--c-text-base)', letterSpacing: '0.06em' }}>SAVE 17%</span>}
            </button>
          ))}
        </div>
        <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-subtle)' }}>· prices in {cur}</span>
      </div>

      {/* Plan cards */}
      <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {ONB_PLANS.map((p) => (
          <OnbPlanCard
            key={p.id}
            plan={p}
            cur={cur}
            symBefore={symBefore}
            annual={annual}
            selected={data.plan === p.id}
            onSelect={() => update({ plan: p.id })}
          />
        ))}
      </div>

      <div style={{ marginTop: 18, padding: 14, borderRadius: 12, background: 'rgba(246,201,69,0.06)', border: '1px solid rgba(246,201,69,0.25)', display: 'flex', gap: 12, alignItems: 'center' }}>
        <Icons.Sparkles style={{ fontSize: 18, color: 'var(--c-gold-deep)', flexShrink: 0 }} />
        <div className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-soft)' }}>
          <strong style={{ color: 'var(--c-text-base)' }}>7-day free trial</strong> on Starter and Pro · no card needed · cancel anytime.
        </div>
      </div>
    </div>
  );
}

function OnbPlanCard({ plan, cur, symBefore, annual, selected, onSelect }) {
  const monthly = plan.prices[cur] ?? plan.prices.USD;
  const yearly  = plan.yearly[cur] ?? plan.yearly.USD;
  const effective = annual ? Math.round(yearly / 12) : monthly;
  const fmt = (n) => n.toLocaleString('en-US');
  const curSym = cur === 'USD' ? '$' : cur;

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        position: 'relative',
        padding: 22,
        background: selected ? 'rgba(246,201,69,0.06)' : 'var(--c-surface-card)',
        border: `1px solid ${selected ? 'rgba(246,201,69,0.55)' : 'var(--c-surface-border)'}`,
        borderRadius: 16,
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'all 180ms',
        boxShadow: selected ? '0 8px 24px rgba(246,201,69,0.12)' : 'var(--sh-card)',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}
    >
      {/* Selected indicator */}
      <span
        style={{
          position: 'absolute',
          top: 14, right: 14,
          width: 20, height: 20, borderRadius: '50%',
          border: `2px solid ${selected ? 'var(--c-gold-deep)' : 'var(--c-surface-border-strong)'}`,
          background: selected ? 'var(--c-gold)' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {selected && <Icons.Check style={{ fontSize: 12, color: 'var(--c-text-base)', strokeWidth: 3 }} />}
      </span>

      {plan.badge && (
        <span
          className="font-mono"
          style={{
            position: 'absolute',
            top: -10, left: 16,
            fontSize: 8, letterSpacing: '0.12em', fontWeight: 700,
            padding: '3px 8px', borderRadius: 999,
            background: 'var(--c-gold)', color: 'var(--c-text-base)',
            textTransform: 'uppercase',
            boxShadow: '0 0 10px rgba(246,201,69,0.35)',
          }}
        >
          {plan.badge}
        </span>
      )}

      <div>
        <h3 className="font-display" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', margin: 0, color: 'var(--c-text-base)' }}>{plan.name}</h3>
        <p style={{ marginTop: 4, fontSize: 11, color: 'var(--c-text-muted)' }}>{plan.tag}</p>
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
          {symBefore && <span className="font-display" style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-text-soft)' }}>{curSym}</span>}
          <span className="font-display tabular-nums" style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1, color: 'var(--c-text-base)' }}>
            {fmt(effective)}
          </span>
          {!symBefore && <span className="font-display" style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text-muted)', marginLeft: 4 }}>{curSym}</span>}
          <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-muted)', marginLeft: 4 }}>/mo</span>
        </div>
        <div className="font-mono" style={{ marginTop: 4, fontSize: 9, color: 'var(--c-text-subtle)' }}>
          {annual ? `Billed yearly · ${curSym}${symBefore ? '' : ' '}${fmt(yearly)}` : 'Billed monthly'}
        </div>
      </div>

      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {plan.bullets.map((b, i) => (
          <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
            <Icons.Check style={{ fontSize: 11, color: 'var(--c-scale-text)', marginTop: 2, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'var(--c-text-soft)', lineHeight: 1.5 }}>{b}</span>
          </li>
        ))}
      </ul>
    </button>
  );
}

function ReviewStep({ data, market }) {
  const ages = Object.entries(data.ages).filter(([, v]) => v).map(([k]) => k);
  const interests = Object.entries(data.interests).filter(([, v]) => v).map(([k]) => k);
  const channels = CHANNELS.filter((c) => data.channels[c.id]).map((c) => c.label);
  const tier = SPEND_TIERS.find((t) => t.id === data.spendTier);
  const lang = LANGUAGES.find((l) => l.id === data.language);
  const dialect = DIALECTS.find((d) => d.id === data.dialect);
  const tone = TONES.find((t) => t.id === data.tone);
  const objective = OBJECTIVES.find((o) => o.id === data.objective);

  return (
    <div>
      <Eyebrow>Step 9 · Review</Eyebrow>
      <BigHeader>One last look.</BigHeader>
      <Lede>Confirm the setup. Lumi will bootstrap with this context and start watching the moment you launch.</Lede>
      <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxWidth: 760 }}>
        <ReviewRow label="Brand"    icon={Icons.Layout} value={data.name || '—'} />
        <ReviewRow label="Market"   icon={Icons.Globe}  value={`${market.label} · ${data.city}`} />
        <ReviewRow label="Audience" icon={Icons.Eye}    value={`${ages.join(', ') || '—'} · ${GENDERS.find((g) => g.id === data.gender)?.label}`} sub={interests.join(' · ')} wide />
        <ReviewRow label="Voice"    icon={Icons.Send}   value={`${lang?.label} · ${dialect?.label}`}  sub={tone?.label} />
        <ReviewRow label="Channels" icon={Icons.Wifi}   value={channels.length ? channels.join(' · ') : '—'} />
        <ReviewRow label="Spend"    icon={Icons.BarChart} value={`${data.currency} ${tier?.label || ''}`} />
        <ReviewRow label="Objective" icon={objective?.Icon || Icons.Target} value={objective?.label || '—'} sub={data.objective === 'custom' ? data.customObjective : objective?.sub} wide />
        {(() => {
          const plan = ONB_PLANS.find((p) => p.id === data.plan);
          if (!plan) return null;
          const cur = data.currency || 'USD';
          const annual = data.billing === 'annual';
          const monthly = plan.prices[cur] ?? plan.prices.USD;
          const yearly  = plan.yearly[cur] ?? plan.yearly.USD;
          const eff = annual ? Math.round(yearly / 12) : monthly;
          const sym = cur === 'USD' ? '$' : `${cur} `;
          return (
            <ReviewRow
              label="Plan"
              icon={Icons.Zap}
              value={`${plan.name} · ${sym}${eff.toLocaleString('en-US')}/mo`}
              sub={annual ? `Billed annually · ${sym}${yearly.toLocaleString('en-US')}` : 'Billed monthly · 7-day trial'}
              wide
            />
          );
        })()}
      </div>
      <div style={{ marginTop: 24, padding: 18, borderRadius: 14, background: 'rgba(246,201,69,0.06)', border: '1px solid rgba(246,201,69,0.30)', display: 'flex', gap: 14, alignItems: 'center', maxWidth: 760 }}>
        <Icons.Sparkles style={{ fontSize: 22, color: 'var(--c-gold-deep)', flexShrink: 0 }} />
        <div>
          <div className="font-display" style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-text-base)' }}>Lumi's first sweep starts on launch.</div>
          <div style={{ marginTop: 2, fontSize: 12, color: 'var(--c-text-soft)' }}>We'll scan your last 14 days and stamp every verdict with cash impact. Lumi will be tuned to your audience, voice, and objective from day one.</div>
        </div>
      </div>
    </div>
  );
}

function ReviewRow({ label, value, sub, icon: Icon, wide }) {
  return (
    <div style={{ gridColumn: wide ? '1 / -1' : 'auto', display: 'flex', gap: 12, padding: '12px 14px', background: 'var(--c-surface-card)', border: '1px solid var(--c-surface-border)', borderRadius: 12, alignItems: 'flex-start' }}>
      <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(246,201,69,0.10)', color: 'var(--c-gold-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon style={{ fontSize: 14 }} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="font-mono" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-text-muted)' }}>{label}</div>
        <div className="font-display" style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-base)', marginTop: 2 }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--c-text-soft)', marginTop: 3, lineHeight: 1.5 }}>{sub}</div>}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// PREVIEW PANE
// ══════════════════════════════════════════════════════════════
function PreviewPane({ data, market, step }) {
  const initials = (data.name || 'W').split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'WS';
  const channelList = CHANNELS.filter((c) => data.channels[c.id]).map((c) => c.label);
  const tierLabel = SPEND_TIERS.find((t) => t.id === data.spendTier)?.label || '';
  const tone = TONES.find((t) => t.id === data.tone);
  const dialect = DIALECTS.find((d) => d.id === data.dialect);
  const ages = Object.entries(data.ages).filter(([, v]) => v).map(([k]) => k);
  const interests = Object.entries(data.interests).filter(([, v]) => v).map(([k]) => k);

  return (
    <div style={{ position: 'sticky', top: 24 }}>
      <div className="section-label" style={{ marginBottom: 12 }}>Live preview</div>

      {/* Workspace card */}
      <div style={{ background: 'var(--c-surface-light)', border: '1px solid var(--c-surface-border)', borderRadius: 16, padding: 14, marginBottom: 14 }}>
        <div className="section-label" style={{ marginBottom: 8, fontSize: 9 }}>Workspace</div>
        <div style={{ position: 'relative', borderRadius: 11, border: '1px solid var(--c-surface-border)', background: 'var(--c-surface-card)', padding: 12, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: -40, right: -40, width: 80, height: 80, borderRadius: '50%', background: 'radial-gradient(circle, rgba(246,201,69,0.18), transparent 70%)', pointerEvents: 'none' }} />
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: 'linear-gradient(135deg, var(--c-gold), var(--c-gold-deep))', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--sh-gold-glow)', flexShrink: 0 }}>
              <span className="font-display" style={{ fontWeight: 700, fontSize: 12, color: 'var(--c-on-gold)' }}>{initials}</span>
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="font-display" style={{ fontSize: 12, fontWeight: 700, color: 'var(--c-text-base)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.name || 'Your workspace'}</div>
              <div className="font-mono" style={{ fontSize: 9, color: 'var(--c-text-muted)', marginTop: 2 }}>{data.tag || `${data.city} · ${market.label}`}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 5, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', marginBottom: 8 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--c-scale)', animation: 'intel-pulse 1.6s ease-in-out infinite' }} />
            <span className="font-mono" style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--c-scale-text)', fontWeight: 600 }}>Ready to watch</span>
          </div>
          <div className="font-mono" style={{ fontSize: 9, color: 'var(--c-text-muted)', marginBottom: 4 }}>Spend: <span style={{ color: 'var(--c-text-soft)' }}>{data.currency} {tierLabel || '—'}</span></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
            {channelList.length > 0 ? channelList.map((c) => (
              <span key={c} className="font-mono" style={{ fontSize: 8, letterSpacing: '0.06em', padding: '1px 5px', borderRadius: 3, background: 'var(--c-surface-light)', color: 'var(--c-text-muted)', border: '1px solid var(--c-surface-border)' }}>{c.toUpperCase()}</span>
            )) : <span className="font-mono" style={{ fontSize: 9, color: 'var(--c-text-subtle)', fontStyle: 'italic' }}>No channels yet</span>}
          </div>
        </div>
      </div>

      {/* Audience capsule */}
      {(ages.length > 0 || interests.length > 0) && (
        <PreviewCapsule title="Audience" icon={Icons.Eye}>
          <div className="font-display" style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-text-base)' }}>{ages.join(', ') || '—'} · {GENDERS.find((g) => g.id === data.gender)?.label}</div>
          <div className="font-mono" style={{ fontSize: 9, color: 'var(--c-text-muted)', marginTop: 3 }}>{interests.slice(0, 4).join(' · ') || '—'}{interests.length > 4 ? ` +${interests.length - 4}` : ''}</div>
        </PreviewCapsule>
      )}

      {/* Voice capsule */}
      {step >= 3 && (
        <PreviewCapsule title="Voice" icon={Icons.Send}>
          <div className="font-display" style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-text-base)' }}>{LANGUAGES.find((l) => l.id === data.language)?.label} · {dialect?.label}</div>
          <div className="font-mono" style={{ fontSize: 9, color: 'var(--c-gold-deep)', marginTop: 3 }}>{tone?.label}</div>
        </PreviewCapsule>
      )}

      {/* Unlocks */}
      <div style={{ marginTop: 6 }}>
        <div className="section-label" style={{ marginBottom: 8 }}>What this unlocks</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <UnlockRow done={step >= 1} text="Workspace HQ" />
          <UnlockRow done={step >= 2} text="Audience-tuned reasoning" />
          <UnlockRow done={step >= 3} text="On-brand copy + dialect" />
          <UnlockRow done={step >= 4} text="Channel-aware verdicts" />
          <UnlockRow done={step >= 5} text="Spend-calibrated thresholds" />
          <UnlockRow done={step >= 6} text="Objective-tuned verdicts" />
          <UnlockRow done={step >= 7} text="Plan locked in" />
          <UnlockRow done={step >= 8} text="First radar sweep" highlight />
        </div>
      </div>
    </div>
  );
}

function PreviewCapsule({ title, icon: Icon, children }) {
  return (
    <div style={{ background: 'var(--c-surface-light)', border: '1px solid var(--c-surface-border)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Icon style={{ fontSize: 11, color: 'var(--c-gold-deep)' }} />
        <span className="section-label" style={{ fontSize: 9 }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function UnlockRow({ done, text, highlight }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 14, height: 14, borderRadius: '50%', background: done ? (highlight ? 'var(--c-gold)' : 'var(--c-scale-bg)') : 'var(--c-surface-elevated)', color: highlight ? 'var(--c-text-base)' : 'var(--c-scale-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: done ? 'none' : '1px dashed var(--c-surface-border-strong)', transition: 'all 240ms' }}>
        {done && <Icons.Check style={{ fontSize: 9, strokeWidth: 3 }} />}
      </span>
      <span style={{ fontSize: 11, color: done ? 'var(--c-text-base)' : 'var(--c-text-subtle)', fontWeight: done && highlight ? 600 : 400 }}>{text}</span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// Small primitives
// ══════════════════════════════════════════════════════════════
function Eyebrow({ children }) {
  return <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-gold-deep)', fontWeight: 600, marginBottom: 10 }}>{children}</div>;
}
function BigHeader({ children }) {
  return <h1 className="font-display" style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-0.03em', margin: 0, lineHeight: 1.1, color: 'var(--c-text-base)', textWrap: 'balance' }}>{children}</h1>;
}
function Lede({ children }) {
  return <p style={{ marginTop: 10, fontSize: 15, color: 'var(--c-text-soft)', maxWidth: 620, lineHeight: 1.55, textWrap: 'pretty' }}>{children}</p>;
}
function Field({ label, hint, optional, children }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <label className="font-display" style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-base)' }}>{label}</label>
        {optional && <span className="font-mono" style={{ fontSize: 10, color: 'var(--c-text-subtle)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Optional</span>}
        {hint && <span className="font-mono" style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function CheckBox({ on }) {
  return (
    <div style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${on ? 'var(--c-gold-deep)' : 'var(--c-surface-border-strong)'}`, background: on ? 'var(--c-gold)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 150ms' }}>
      {on && <Icons.Check style={{ fontSize: 13, color: 'var(--c-text-base)', strokeWidth: 3 }} />}
    </div>
  );
}
function RadioDot({ on }) {
  return (
    <span style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${on ? 'var(--c-gold-deep)' : 'var(--c-surface-border-strong)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {on && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--c-gold)' }} />}
    </span>
  );
}

const tileBtn = (on) => ({
  padding: '10px 12px',
  borderRadius: 10,
  background: on ? 'rgba(246,201,69,0.08)' : 'var(--c-surface-card)',
  border: `1px solid ${on ? 'rgba(246,201,69,0.55)' : 'var(--c-surface-border)'}`,
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'all 150ms',
});

const chipBtn = (on) => ({
  padding: '6px 12px',
  background: on ? 'var(--c-gold)' : 'var(--c-surface-card)',
  color: on ? 'var(--c-text-base)' : 'var(--c-text-soft)',
  border: `1px solid ${on ? 'var(--c-gold-deep)' : 'var(--c-surface-border)'}`,
  borderRadius: 999,
  fontSize: 12,
  fontWeight: on ? 600 : 500,
  cursor: 'pointer',
  transition: 'all 150ms',
});

const inputStyle = {
  width: '100%',
  padding: '11px 14px',
  fontSize: 14,
  fontFamily: 'var(--f-body)',
  color: 'var(--c-text-base)',
  background: 'var(--c-surface-card)',
  border: '1px solid var(--c-surface-border)',
  borderRadius: 10,
  outline: 'none',
  transition: 'border-color 150ms, box-shadow 150ms',
};

// Focus styling for all inputs
document.addEventListener('focusin', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    e.target.style.borderColor = 'rgba(246,201,69,0.6)';
    e.target.style.boxShadow = '0 0 0 3px rgba(246,201,69,0.12)';
  }
});
document.addEventListener('focusout', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    e.target.style.borderColor = 'var(--c-surface-border)';
    e.target.style.boxShadow = 'none';
  }
});

ReactDOM.createRoot(document.getElementById('root')).render(<Onboarding />);

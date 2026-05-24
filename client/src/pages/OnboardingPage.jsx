// ============================================================
// MARCOM / Lumi — OnboardingPage
// ------------------------------------------------------------
// Three-step wizard collecting the brand context (Decision B3:
// stored on User.context). On finish: PUT /api/campaigns/me/context
// then redirect to /app.
//
// State is local — back navigation between steps preserves all
// fields. No external state library needed.
//
// Design audit pass (7 fixes):
//   P1 - near-black bg + radial gold ambient; glassy card
//   P2 - vertical whitespace reduction (py-10→8, mb-8→4/5)
//   P3 - centered stepper, lumi-gold active, animated fill connector
//   P4 - header "why" sentence, muted mono label
//   P5 - Field primary prop elevates Company Name label weight
//   P6 - border-t divider above CTA rows; ghost back button
//   P7 - improved input contrast; white/* opacity tokens throughout
// ============================================================
import { useState }     from 'react';
import { useNavigate }  from 'react-router-dom';
import { useAuth }      from '@/context/AuthContext.jsx';
import { toast }        from 'sonner';
import {
  Building2, Globe, Briefcase, Megaphone,
  ArrowRight, ArrowLeft, Loader2, Sparkles, CheckCircle2,
} from 'lucide-react';
import { api }                       from '@/lib/api.js';
import { cn }                        from '@/lib/utils.js';
import { primeContextCache }         from '@/router/ProtectedRoute.jsx';

const INDUSTRIES = ['E-commerce', 'SaaS', 'Real Estate', 'Healthcare', 'F&B', 'Fashion', 'Education', 'Finance', 'Other'];

// MENA-first market list with dialect mapping
const MARKETS = [
  'Egypt', 'Saudi Arabia', 'UAE', 'Kuwait', 'Qatar', 'Bahrain', 'Oman',
  'Jordan', 'Lebanon', 'Iraq', 'Libya', 'Tunisia', 'Algeria', 'Morocco',
  'Palestine', 'Yemen', 'Sudan',
  'USA', 'UK', 'Europe', 'Global',
];

// Dialect each AI response should use per market
const DIALECT_MAP = {
  'Egypt':        'Egyptian Arabic (عامية مصرية)',
  'Saudi Arabia': 'Gulf Arabic / Najdi (خليجي نجدي)',
  'UAE':          'Gulf Arabic / Emirati (خليجي إماراتي)',
  'Kuwait':       'Gulf Arabic / Kuwaiti (خليجي كويتي)',
  'Qatar':        'Gulf Arabic / Qatari (خليجي قطري)',
  'Bahrain':      'Gulf Arabic / Bahraini (خليجي بحريني)',
  'Oman':         'Gulf Arabic / Omani (خليجي عماني)',
  'Jordan':       'Levantine Arabic / Jordanian (شامي أردني)',
  'Lebanon':      'Levantine Arabic / Lebanese (شامي لبناني)',
  'Iraq':         'Iraqi Arabic (عامية عراقية)',
  'Libya':        'Libyan Arabic (عامية ليبية)',
  'Tunisia':      'Tunisian Arabic (دارجة تونسية)',
  'Algeria':      'Algerian Arabic (دارجة جزائرية)',
  'Morocco':      'Moroccan Darija (دارجة مغربية)',
  'Palestine':    'Levantine Arabic / Palestinian (شامي فلسطيني)',
  'Yemen':        'Yemeni Arabic (عامية يمنية)',
  'Sudan':        'Sudanese Arabic (عامية سودانية)',
  'USA':          'American English',
  'UK':           'British English',
  'Europe':       'European English',
  'Global':       'Modern Standard Arabic / English',
};

const LANGUAGES = ['Arabic', 'English', 'Arabic + English (bilingual)'];

const TONES      = [
  { id: 'bold',    title: 'Bold & Direct',         desc: 'Punchy, confident, conversion-first.' },
  { id: 'warm',    title: 'Warm & Human',          desc: 'Conversational, empathetic, story-led.' },
  { id: 'premium', title: 'Premium & Polished',    desc: 'Considered, restrained, design-led.' },
  { id: 'gen-z',   title: 'Playful & Gen-Z',       desc: 'Meme-aware, fast, native to short-form.' },
  { id: 'edu',     title: 'Educational & Trusted', desc: 'Authoritative, citation-friendly, calm.' },
];
const GOALS = ['Generate Leads', 'Build Awareness', 'Drive Sales', 'Grow Following', 'Launch Product', 'Retain Customers'];

const PLATFORMS = [
  { id: 'meta',     label: 'Meta Ads',     icon: '📘' },
  { id: 'google',   label: 'Google Ads',   icon: '🔍' },
  { id: 'tiktok',   label: 'TikTok Ads',   icon: '🎵' },
  { id: 'linkedin', label: 'LinkedIn Ads', icon: '💼' },
  { id: 'snapchat', label: 'Snapchat Ads', icon: '👻' },
  { id: 'twitter',  label: 'X / Twitter',  icon: '🐦' },
];

const STEPS = [
  { n: 1, label: 'Company',  icon: Building2 },
  { n: 2, label: 'Business', icon: Briefcase },
  { n: 3, label: 'Voice',    icon: Megaphone },
];

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [step, setStep]   = useState(1);
  const [busy, setBusy]   = useState(false);
  const [form, setForm]   = useState({
    companyName:    currentUser?.displayName || '',
    industry:       '',
    website:        '',
    market:         '',
    dialect:        '',           // auto-set from DIALECT_MAP on market change
    language:       'Arabic',     // default: Arabic
    businessType:   'B2C',
    targetAudience: '',
    competitor:     '',
    tone:           '',
    monthlyGoal:    '',
    neverDo:        '',
    platforms:      [],
  });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const togglePlatform = (id) =>
    setForm((f) => ({
      ...f,
      platforms: f.platforms.includes(id)
        ? f.platforms.filter((p) => p !== id)
        : [...f.platforms, id],
    }));

  const validate = (n) => {
    if (n === 1) return form.companyName && form.industry && form.market && form.language;
    if (n === 2) return form.businessType && form.targetAudience;
    if (n === 3) return form.tone && form.monthlyGoal;
  };

  const finish = async (afterCsv = false) => {
    if (busy) return;

    if (!form.companyName || !form.industry || !form.market || !form.businessType || !form.tone || !form.monthlyGoal) {
      toast.error('Please complete all required fields before finishing.');
      setStep(1);
      return;
    }

    setBusy(true);
    try {
      const res = await api.put('/api/campaigns/me/context', {
        context: form,
        email:   currentUser?.email,
        workspaceName: form.companyName || 'My Workspace',
      });

      primeContextCache(res.data?.user?.context ?? form);
      toast.success(afterCsv ? 'Context saved · CSV processed.' : 'Context saved — welcome aboard.');
      await Promise.resolve();
      sessionStorage.setItem('marcom:firstActivation', '1');
      navigate('/app', { replace: true });
    } catch (err) {
      const detail = err.response?.data;
      const msg    = detail?.hint || detail?.detail || detail?.error || err.message || 'Could not save context';
      console.error('[onboarding] PUT /me/context failed', detail || err);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-surface-dark text-white/90 overflow-x-hidden"
      style={{ backgroundImage: 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(246,201,69,0.06) 0%, transparent 60%)' }}
    >
      {/* P2: py-10 → py-8 → mobile: py-6 sm:py-8 */}
      <div className="mx-auto max-w-2xl px-3 sm:px-4 py-6 sm:py-8">

        {/* ── Header (P4) ───────────────────────────────────── */}
        {/* P2: mb-8 → mb-4 */}
        <div className="mb-4 text-center">
          <div className="inline-flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-lumi-gold" />
            <span className="font-mono text-xs font-semibold uppercase tracking-widest text-lumi-gold/80">
              Lumi · Setup
            </span>
          </div>
          <h1 className="mt-3 decision-title text-white">
            Tell us how to think about your brand
          </h1>
          {/* P4: added "why" clarity sentence */}
          <p className="mt-2 mx-auto max-w-sm text-sm text-white/45 leading-relaxed">
            This helps Lumi generate market-specific verdicts, campaign analysis,
            and growth decisions tailored to your business.
          </p>
        </div>

        {/* ── Progress stepper (P3) ────────────────────────── */}
        {/* P2: mb-8 → mb-5 */}
        <div className="mb-5">
          <div className="flex items-center justify-center gap-0">
            {STEPS.map((s, i) => {
              const Icon   = s.icon;
              const active = step === s.n;
              const done   = step > s.n;
              return (
                <div key={s.n} className="flex items-center">
                  <div className="flex flex-col items-center gap-1.5">
                    <div className={cn(
                      'flex h-7 w-7 sm:h-9 sm:w-9 items-center justify-center rounded-full border-2 transition-all duration-300',
                      active && 'border-lumi-gold bg-lumi-gold/15 text-lumi-gold scale-110',
                      done   && 'border-signal-scale bg-signal-scale/15 text-signal-scale',
                      !active && !done && 'border-white/15 text-white/30',
                    )}>
                      {done
                        ? <CheckCircle2 className="h-4 w-4" />
                        : <Icon className={cn('h-4 w-4', active && 'drop-shadow-[0_0_6px_rgba(246,201,69,0.6)]')} />
                      }
                    </div>
                    <span className={cn(
                      'text-[10px] font-semibold tracking-widest uppercase transition-colors duration-300',
                      active && 'text-lumi-gold',
                      done   && 'text-signal-scale',
                      !active && !done && 'text-white/25',
                    )}>
                      {s.label}
                    </span>
                  </div>
                  {/* Animated fill connector — not after last step */}
                  {i < STEPS.length - 1 && (
                    <div className="relative mx-1 sm:mx-3 h-0.5 w-20 overflow-hidden rounded-full bg-white/10">
                      <div className={cn(
                        'absolute inset-y-0 left-0 rounded-full transition-all duration-500',
                        done ? 'w-full bg-signal-scale/60' : 'w-0',
                      )} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Card (P1) ─────────────────────────────────────── */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-7 shadow-xl shadow-black/30 ring-1 ring-white/5">

          {step === 1 && (
            <Section title="Company basics">
              {/* P5: primary prop → heavier label weight */}
              <Field label="Company Name *" primary>
                <input
                  className={inputCls}
                  value={form.companyName}
                  onChange={(e) => set('companyName', e.target.value)}
                  placeholder="Acme Inc."
                />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <Field label="Industry *">
                  <select className={inputCls} value={form.industry} onChange={(e) => set('industry', e.target.value)}>
                    <option value="">Select…</option>
                    {INDUSTRIES.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </Field>
                <Field label="Primary Market *">
                  <select
                    className={inputCls}
                    value={form.market}
                    onChange={(e) => {
                      const m = e.target.value;
                      set('market', m);
                      set('dialect', DIALECT_MAP[m] || '');
                    }}
                  >
                    <option value="">Select…</option>
                    <optgroup label="MENA Region">
                      {MARKETS.slice(0, 17).map((x) => <option key={x} value={x}>{x}</option>)}
                    </optgroup>
                    <optgroup label="International">
                      {MARKETS.slice(17).map((x) => <option key={x} value={x}>{x}</option>)}
                    </optgroup>
                  </select>
                </Field>
              </div>
              {/* Language preference */}
              <Field label="Content Language *">
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  {LANGUAGES.map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => set('language', lang)}
                      className={cn(
                        'rounded-xl border p-2 sm:p-2.5 text-xs sm:text-sm font-semibold text-center transition-all',
                        form.language === lang
                          ? 'border-lumi-gold/50 bg-lumi-gold/10 text-lumi-gold'
                          : 'border-white/8 bg-white/[0.03] text-white/50 hover:border-white/20 hover:text-white/70',
                      )}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
                {/* Show auto-detected dialect when market is selected */}
                {form.dialect && (
                  <p className="mt-1.5 text-[11px] text-lumi-gold/70 font-mono">
                    ✦ Dialect: {form.dialect}
                  </p>
                )}
              </Field>
              <Field label="Website (optional)">
                <div className="relative">
                  <Globe className="absolute left-3 top-2.5 h-4 w-4 text-white/30" />
                  <input
                    className={cn(inputCls, 'pl-9')}
                    value={form.website}
                    onChange={(e) => set('website', e.target.value)}
                    placeholder="https://acme.com"
                  />
                </div>
              </Field>
            </Section>
          )}

          {step === 2 && (
            <Section title="Business model">
              <Field label="Business Type *">
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  {['B2B', 'B2C', 'Both'].map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => set('businessType', t)}
                      className={cn(
                        'rounded-xl border p-2.5 sm:p-3 text-xs sm:text-sm font-semibold transition-all',
                        form.businessType === t
                          ? 'border-lumi-gold/50 bg-lumi-gold/10 text-lumi-gold'
                          : 'border-white/8 bg-white/[0.03] text-white/50 hover:border-white/20 hover:text-white/70',
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Ad Platforms (select all you use)">
                <div className="grid grid-cols-3 gap-2">
                  {PLATFORMS.map((p) => {
                    const active = form.platforms.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => togglePlatform(p.id)}
                        className={cn(
                          'flex items-center gap-2 rounded-xl border p-3 text-left text-sm transition-all',
                          active
                            ? 'border-lumi-gold/50 bg-lumi-gold/10 text-lumi-gold'
                            : 'border-white/8 bg-white/[0.03] text-white/50 hover:border-white/20',
                        )}
                      >
                        <span>{p.icon}</span>
                        <span className="text-xs font-medium">{p.label}</span>
                        {active && (
                          <CheckCircle2 className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-lumi-gold" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label="Target Audience *">
                <textarea
                  className={cn(inputCls, 'min-h-[72px] sm:min-h-[88px]')}
                  value={form.targetAudience}
                  onChange={(e) => set('targetAudience', e.target.value)}
                  placeholder="Who specifically are you trying to reach?"
                />
              </Field>
              <Field label="Main Competitor (optional)">
                <input
                  className={inputCls}
                  value={form.competitor}
                  onChange={(e) => set('competitor', e.target.value)}
                  placeholder="Name a competitor whose ads you study."
                />
              </Field>
            </Section>
          )}

          {step === 3 && (
            <Section title="Brand voice">
              <Field label="Tone *">
                <div className="space-y-2">
                  {TONES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => set('tone', t.id)}
                      className={cn(
                        'w-full rounded-xl border p-2.5 sm:p-3 text-left transition-all',
                        form.tone === t.id
                          ? 'border-lumi-gold/50 bg-lumi-gold/8'
                          : 'border-white/8 bg-white/[0.03] hover:border-white/20',
                      )}
                    >
                      <div className="text-sm font-semibold text-white/90">{t.title}</div>
                      <div className="text-xs text-white/45 mt-0.5">{t.desc}</div>
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Monthly Goal *">
                <select className={inputCls} value={form.monthlyGoal} onChange={(e) => set('monthlyGoal', e.target.value)}>
                  <option value="">Select…</option>
                  {GOALS.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </Field>
              <Field label='One thing Lumi must NEVER do (optional)'>
                <input
                  className={inputCls}
                  value={form.neverDo}
                  onChange={(e) => set('neverDo', e.target.value)}
                  placeholder='e.g. "Never use exclamation marks"'
                />
              </Field>
            </Section>
          )}

          {/* ── Nav row (P6: border-t divider) ───────────────── */}
          {step < 3 && (
            <div className="mt-5 sm:mt-6 flex justify-between gap-2 border-t border-white/8 pt-5">
              <button
                type="button"
                onClick={() => setStep((n) => Math.max(1, n - 1))}
                disabled={step === 1}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-white/40 hover:text-white/70 hover:bg-white/5 disabled:opacity-30 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!validate(step)) {
                    toast.error('Fill in the required fields to continue.');
                    return;
                  }
                  setStep((n) => Math.min(3, n + 1));
                }}
                className="inline-flex items-center justify-center gap-1 rounded-xl bg-lumi-gold px-5 py-2.5 sm:py-2.5 font-display text-sm font-semibold text-dark-base hover:bg-lumi-deep active:scale-[0.98] shadow-gold-glow transition-all min-w-[120px]"
              >
                Continue <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {step === 3 && (
            <div className="mt-5 sm:mt-6 flex justify-between gap-2 border-t border-white/8 pt-5">
              <button
                type="button"
                onClick={() => setStep((n) => Math.max(1, n - 1))}
                disabled={false}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-white/40 hover:text-white/70 hover:bg-white/5 disabled:opacity-30 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!validate(step)) {
                    toast.error('Fill in the required fields to continue.');
                    return;
                  }
                  finish(false);
                }}
                disabled={busy}
                className="inline-flex items-center justify-center gap-1 rounded-xl bg-lumi-gold px-5 py-2.5 font-display text-sm font-semibold text-dark-base hover:bg-lumi-deep active:scale-[0.98] shadow-gold-glow transition-all disabled:opacity-50 disabled:cursor-not-allowed min-w-[160px] sm:min-w-0"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Completing…
                  </>
                ) : (
                  <>
                    Complete &amp; Enter App <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          )}

          {step === 3 && busy && (
            <div className="mt-2 text-center font-mono text-xs text-white/35 animate-pulse">
              Saving your context…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// P7: improved input contrast — white/5 bg, white/10 border, lumi-gold focus ring
const inputCls =
  'w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-white/90 placeholder:text-white/30 focus:border-lumi-gold/60 focus:bg-white/[0.07] focus:outline-none focus:ring-1 focus:ring-lumi-gold/20 transition-all duration-150';

// P7: Section title — muted mono label
function Section({ title, children }) {
  return (
    <div>
      <h2 className="mb-4 sm:mb-5 font-mono text-xs font-semibold uppercase tracking-widest text-white/35">{title}</h2>
      <div className="space-y-3 sm:space-y-4">{children}</div>
    </div>
  );
}

// P5: primary prop elevates Company Name label weight
function Field({ label, primary = false, children }) {
  return (
    <label className="block">
      <span className={cn(
        'mb-1.5 block',
        primary
          ? 'text-sm font-semibold text-white/80'
          : 'font-mono text-xs font-medium uppercase tracking-wide text-white/40',
      )}>
        {label}
      </span>
      {children}
    </label>
  );
}

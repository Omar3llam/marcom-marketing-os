// ============================================================
// MARCOM / Lumi — OnboardingPage
// ------------------------------------------------------------
// Three-step wizard collecting the brand context (Decision B3:
// stored on User.context). On finish: PUT /api/campaigns/me/context
// then redirect to /app.
//
// State is local — back navigation between steps preserves all
// fields. No external state library needed.
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
const MARKETS    = ['Egypt', 'Saudi Arabia', 'UAE', 'Kuwait', 'Lebanon', 'Jordan', 'Morocco', 'USA', 'UK', 'Europe', 'Global'];
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
    if (n === 1) return form.companyName && form.industry && form.market;
    if (n === 2) return form.businessType && form.targetAudience;
    if (n === 3) return form.tone && form.monthlyGoal;
  };

  const finish = async (afterCsv = false) => {
    if (busy) return;

    // Hard precondition: companyName is required by the route guard.
    // All required fields must be completed before navigating to /app.
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

      // Prime the route-guard cache from the PUT response itself —
      // eliminates the race where /app's ProtectedRoute fires a
      // refetch and momentarily sees `hasContext: false`. We pass
      // the saved context (with companyName) so isOnboarded() === true.
      primeContextCache(res.data?.user?.context ?? form);

      toast.success(afterCsv ? 'Context saved · CSV processed.' : 'Context saved — welcome aboard.');

      // tick the event loop once so React commits the cache update
      // before we navigate.
      await Promise.resolve();
      navigate('/app', { replace: true });
    } catch (err) {
      const detail = err.response?.data;
      const msg    = detail?.hint || detail?.detail || detail?.error || err.message || 'Could not save context';
      // eslint-disable-next-line no-console
      console.error('[onboarding] PUT /me/context failed', detail || err);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-light font-body">
      <div className="mx-auto max-w-2xl px-4 py-10">

        {/* ── Header ──────────────────────────────────────────── */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-lumi-gold" />
            <span className="font-mono text-xs font-semibold uppercase tracking-widest text-dark-soft">
              Lumi · Onboarding
            </span>
          </div>
          <h1 className="mt-2 font-display text-2xl font-bold text-dark-base">
            Tell us how to think about your brand
          </h1>
          <p className="mt-1 font-body text-sm text-dark-soft">
            Lumi grounds every recommendation in the context you set here.
          </p>
        </div>

        {/* ── Progress stepper ─────────────────────────────────── */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {STEPS.map((s, i) => {
              const Icon   = s.icon;
              const active = step === s.n;
              const done   = step > s.n;
              return (
                <div key={s.n} className="flex flex-1 items-center">
                  <div className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all',
                    active && 'border-lumi-gold bg-lumi-gold text-dark-base shadow-gold-glow',
                    done   && 'border-lumi-gold bg-lumi-gold/15 text-lumi-deep',
                    !active && !done && 'border-surface-border bg-surface-card text-dark-soft',
                  )}>
                    {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={cn(
                      'mx-2 h-0.5 flex-1 transition-colors',
                      step > s.n ? 'bg-lumi-gold/40' : 'bg-surface-border',
                    )} />
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between">
            {STEPS.map((s) => (
              <span
                key={s.n}
                className={cn(
                  'font-mono text-[10px] uppercase tracking-widest transition-colors',
                  step === s.n && 'font-semibold text-lumi-deep',
                  step > s.n  && 'text-signal-scale',
                  step < s.n  && 'text-dark-soft opacity-50',
                )}
              >
                {s.label}
              </span>
            ))}
          </div>
        </div>

        {/* ── Card ─────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-surface-border bg-surface-card p-6 shadow-card">

          {step === 1 && (
            <Section title="Company basics">
              <Field label="Company Name *">
                <input
                  className={inputCls}
                  value={form.companyName}
                  onChange={(e) => set('companyName', e.target.value)}
                  placeholder="Acme Inc."
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Industry *">
                  <select className={inputCls} value={form.industry} onChange={(e) => set('industry', e.target.value)}>
                    <option value="">Select…</option>
                    {INDUSTRIES.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </Field>
                <Field label="Primary Market *">
                  <select className={inputCls} value={form.market} onChange={(e) => set('market', e.target.value)}>
                    <option value="">Select…</option>
                    {MARKETS.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Website (optional)">
                <div className="relative">
                  <Globe className="absolute left-3 top-2.5 h-4 w-4 text-dark-soft/50" />
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
                <div className="grid grid-cols-3 gap-3">
                  {['B2B', 'B2C', 'Both'].map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => set('businessType', t)}
                      className={cn(
                        'rounded-xl border p-3 text-sm font-semibold transition-all',
                        form.businessType === t
                          ? 'border-lumi-gold bg-lumi-gold/10 text-dark-base shadow-gold-glow'
                          : 'border-surface-border bg-surface-light text-dark-soft hover:border-lumi-gold/40 hover:bg-lumi-gold/5',
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
                            ? 'border-lumi-gold bg-lumi-gold/10 text-dark-base shadow-gold-glow'
                            : 'border-surface-border bg-surface-light text-dark-soft hover:border-lumi-gold/40',
                        )}
                      >
                        <span>{p.icon}</span>
                        <span className="font-body text-xs font-medium">{p.label}</span>
                        {active && (
                          <CheckCircle2 className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-lumi-deep" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label="Target Audience *">
                <textarea
                  className={cn(inputCls, 'min-h-[80px]')}
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
                        'w-full rounded-xl border p-3 text-left transition-all',
                        form.tone === t.id
                          ? 'border-lumi-gold bg-lumi-gold/10 shadow-gold-glow'
                          : 'border-surface-border bg-surface-light hover:border-lumi-gold/40 hover:bg-lumi-gold/5',
                      )}
                    >
                      <div className="font-display text-sm font-semibold text-dark-base">{t.title}</div>
                      <div className="font-body text-xs text-dark-soft">{t.desc}</div>
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

          {/* ── Nav row ───────────────────────────────────────── */}
          {step < 3 && (
            <div className="mt-6 flex justify-between">
              <button
                type="button"
                onClick={() => setStep((n) => Math.max(1, n - 1))}
                disabled={step === 1}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 font-body text-sm text-dark-soft hover:bg-surface-border disabled:opacity-30 transition-colors"
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
                className="inline-flex items-center gap-1 rounded-xl bg-lumi-gold px-5 py-2.5 font-display text-sm font-semibold text-dark-base hover:bg-lumi-deep active:scale-[0.98] shadow-gold-glow transition-all"
              >
                Continue <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {step === 3 && (
            <div className="mt-6 flex justify-between">
              <button
                type="button"
                onClick={() => setStep((n) => Math.max(1, n - 1))}
                disabled={false}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 font-body text-sm text-dark-soft hover:bg-surface-border disabled:opacity-30 transition-colors"
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
                className="inline-flex items-center gap-1 rounded-xl bg-lumi-gold px-5 py-2.5 font-display text-sm font-semibold text-dark-base hover:bg-lumi-deep active:scale-[0.98] shadow-gold-glow transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
            <div className="mt-2 text-center font-mono text-xs text-dark-soft animate-pulse">
              Saving your context…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-surface-border bg-surface-light px-3 py-2 font-body text-sm text-dark-base placeholder:text-dark-soft/40 focus:border-lumi-gold focus:ring-2 focus:ring-lumi-gold/20 focus:outline-none transition-colors';

function Section({ title, children }) {
  return (
    <div>
      <h2 className="mb-4 font-mono text-xs font-bold uppercase tracking-widest text-dark-soft">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-xs font-semibold uppercase tracking-wide text-dark-soft">{label}</span>
      {children}
    </label>
  );
}

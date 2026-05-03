// ============================================================
// MARCOM / Lumi — OnboardingPage
// ------------------------------------------------------------
// Four-step wizard collecting the brand context (Decision B3:
// stored on User.context). On finish: PUT /api/campaigns/me/context
// then redirect to /app. Step 4 also offers an immediate CSV
// upload via <CsvUploader>.
//
// State is local — back navigation between steps preserves all
// fields. No external state library needed.
// ============================================================
import { useState }     from 'react';
import { useNavigate }  from 'react-router-dom';
import { useUser }      from '@clerk/clerk-react';
import { toast }        from 'sonner';
import {
  Building2, Globe, Briefcase, Megaphone, Upload,
  ArrowRight, ArrowLeft, Loader2, Sparkles, CheckCircle2,
} from 'lucide-react';
import { api }                       from '../lib/api.js';
import { cn }                        from '../lib/utils.js';
import CsvUploader                   from '../components/upload/CsvUploader.jsx';
import { clearContextCache }         from '../router/ProtectedRoute.jsx';

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

const STEPS = [
  { n: 1, label: 'Company',    icon: Building2 },
  { n: 2, label: 'Business',   icon: Briefcase },
  { n: 3, label: 'Voice',      icon: Megaphone },
  { n: 4, label: 'First data', icon: Upload },
];

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user } = useUser();
  const [step, setStep]   = useState(1);
  const [busy, setBusy]   = useState(false);
  const [form, setForm]   = useState({
    companyName:    user?.publicMetadata?.companyName || '',
    industry:       '',
    website:        '',
    market:         '',
    businessType:   'B2C',
    targetAudience: '',
    competitor:     '',
    tone:           '',
    monthlyGoal:    '',
    neverDo:        '',
  });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const validate = (n) => {
    if (n === 1) return form.companyName && form.industry && form.market;
    if (n === 2) return form.businessType && form.targetAudience;
    if (n === 3) return form.tone && form.monthlyGoal;
    return true;
  };

  const finish = async (afterCsv = false) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.put('/api/campaigns/me/context', {
        context: form,
        email:   user?.primaryEmailAddress?.emailAddress,
        workspaceName: form.companyName || 'My Workspace',
      });
      clearContextCache();
      toast.success(afterCsv ? 'Context saved · CSV processed.' : 'Context saved — welcome aboard.');
      navigate('/app');
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Could not save context');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="mx-auto max-w-2xl px-4 py-10">
        {/* ── Header ──────────────────────────────────────────── */}
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-2 text-white">
            <Sparkles className="h-5 w-5 text-yellow-400" />
            <span className="font-bold tracking-widest uppercase">Lumi · Onboarding</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold">Tell us how to think about your brand</h1>
          <p className="mt-1 text-sm text-gray-400">
            Lumi grounds every recommendation in the context you set here.
          </p>
        </div>

        {/* ── Progress bar ─────────────────────────────────────── */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {STEPS.map((s, i) => {
              const Icon   = s.icon;
              const active = step === s.n;
              const done   = step > s.n;
              return (
                <div key={s.n} className="flex flex-1 items-center">
                  <div className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full border-2',
                    active && 'border-blue-500 bg-blue-500/15 text-blue-300',
                    done   && 'border-green-500 bg-green-500/15 text-green-300',
                    !active && !done && 'border-gray-700 text-gray-500',
                  )}>
                    {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={cn(
                      'mx-2 h-0.5 flex-1',
                      step > s.n ? 'bg-green-500/40' : 'bg-gray-800',
                    )} />
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-widest text-gray-500">
            {STEPS.map((s) => <span key={s.n}>{s.label}</span>)}
          </div>
        </div>

        {/* ── Card ─────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-6">
          {step === 1 && (
            <Section title="Company basics">
              <Field label="Company Name *">
                <input className={inputCls} value={form.companyName} onChange={(e) => set('companyName', e.target.value)} placeholder="Acme Inc." />
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
                  <Globe className="absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
                  <input className={cn(inputCls, 'pl-9')} value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://acme.com" />
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
                        'rounded-xl border p-3 text-sm font-semibold',
                        form.businessType === t
                          ? 'border-blue-500/60 bg-blue-500/10 text-blue-200'
                          : 'border-gray-800 bg-gray-900/40 text-gray-300 hover:border-gray-700',
                      )}
                    >{t}</button>
                  ))}
                </div>
              </Field>
              <Field label="Target Audience *">
                <textarea className={cn(inputCls, 'min-h-[80px]')} value={form.targetAudience} onChange={(e) => set('targetAudience', e.target.value)} placeholder="Who specifically are you trying to reach?" />
              </Field>
              <Field label="Main Competitor (optional)">
                <input className={inputCls} value={form.competitor} onChange={(e) => set('competitor', e.target.value)} placeholder="Name a competitor whose ads you study." />
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
                        'w-full rounded-xl border p-3 text-left',
                        form.tone === t.id
                          ? 'border-blue-500/60 bg-blue-500/10'
                          : 'border-gray-800 bg-gray-900/40 hover:border-gray-700',
                      )}
                    >
                      <div className="text-sm font-semibold text-white">{t.title}</div>
                      <div className="text-xs text-gray-400">{t.desc}</div>
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
              <Field label="One thing Lumi must NEVER do (optional)">
                <input className={inputCls} value={form.neverDo} onChange={(e) => set('neverDo', e.target.value)} placeholder='e.g. "Never use exclamation marks"' />
              </Field>
            </Section>
          )}

          {step === 4 && (
            <Section title="Upload your first campaign data">
              <p className="-mt-2 mb-4 text-sm text-gray-400">
                Drop a CSV from Meta Ads Manager or Google Ads. We'll classify
                it and seed your decision feed in seconds.
              </p>
              <CsvUploader
                onSuccess={() => finish(true)}
                compact
              />
              <button
                type="button"
                onClick={() => finish(false)}
                disabled={busy}
                className="mt-4 w-full rounded-xl border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800/60"
              >
                I'll upload later — take me into the app
              </button>
            </Section>
          )}

          {/* ── Nav row ───────────────────────────────────────── */}
          {step < 4 && (
            <div className="mt-6 flex justify-between">
              <button
                type="button"
                onClick={() => setStep((n) => Math.max(1, n - 1))}
                disabled={step === 1}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-gray-800 disabled:opacity-30"
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
                  setStep((n) => Math.min(4, n + 1));
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
              >
                Continue <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}
          {step === 4 && busy && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Saving your context…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-blue-500 focus:outline-none';

function Section({ title, children }) {
  return (
    <div>
      <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-gray-400">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-gray-400">{label}</span>
      {children}
    </label>
  );
}

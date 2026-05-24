import { useState }    from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth }     from '@/context/AuthContext.jsx';
import { toast }       from 'sonner';
import { Building2, Briefcase, Megaphone, ArrowRight, ArrowLeft, Loader2, Sparkles, CheckCircle2 } from 'lucide-react';
import { api }                 from '@/lib/api.js';
import { cn }                  from '@/lib/utils.js';
import { primeContextCache }   from '@/router/ProtectedRoute.jsx';
import { Step1Company }        from './steps/Step1Company.jsx';
import { Step2Business }       from './steps/Step2Business.jsx';
import { Step3Voice }          from './steps/Step3Voice.jsx';

const STEPS = [
  { n: 1, label: 'Company',  icon: Building2 },
  { n: 2, label: 'Business', icon: Briefcase },
  { n: 3, label: 'Voice',    icon: Megaphone },
];

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    companyName: currentUser?.displayName || '',
    industry: '', website: '', market: '', dialect: '',
    language: 'Arabic', businessType: 'B2C', targetAudience: '',
    competitor: '', tone: '', monthlyGoal: '', neverDo: '', platforms: [],
  });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const togglePlatform = (id) =>
    setForm((f) => ({ ...f, platforms: f.platforms.includes(id) ? f.platforms.filter((p) => p !== id) : [...f.platforms, id] }));

  const validate = (n) => {
    if (n === 1) return form.companyName && form.industry && form.market && form.language;
    if (n === 2) return form.businessType && form.targetAudience;
    if (n === 3) return form.tone && form.monthlyGoal;
  };

  const finish = async () => {
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
      toast.success('Context saved — welcome aboard.');
      await Promise.resolve();
      sessionStorage.setItem('marcom:firstActivation', '1');
      navigate('/app', { replace: true });
    } catch (err) {
      const detail = err.response?.data;
      const msg = detail?.hint || detail?.detail || detail?.error || err.message || 'Could not save context';
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
      <div className="mx-auto max-w-2xl px-3 sm:px-4 py-6 sm:py-8">
        <div className="mb-4 text-center">
          <div className="inline-flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-lumi-gold" />
            <span className="font-mono text-xs font-semibold uppercase tracking-widest text-lumi-gold/80">Lumi · Setup</span>
          </div>
          <h1 className="mt-3 decision-title text-white">Tell us how to think about your brand</h1>
          <p className="mt-2 mx-auto max-w-sm text-sm text-white/45 leading-relaxed">
            This helps Lumi generate market-specific verdicts, campaign analysis, and growth decisions tailored to your business.
          </p>
        </div>

        <div className="mb-5">
          <div className="flex items-center justify-center gap-0">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
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
                      {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className={cn('h-4 w-4', active && 'drop-shadow-[0_0_6px_rgba(246,201,69,0.6)]')} />}
                    </div>
                    <span className={cn(
                      'text-[10px] font-semibold tracking-widest uppercase transition-colors duration-300',
                      active && 'text-lumi-gold', done && 'text-signal-scale', !active && !done && 'text-white/25',
                    )}>{s.label}</span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className="relative mx-1 sm:mx-3 h-0.5 w-20 overflow-hidden rounded-full bg-white/10">
                      <div className={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-500', done ? 'w-full bg-signal-scale/60' : 'w-0')} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-7 shadow-xl shadow-black/30 ring-1 ring-white/5">
          {step === 1 && <Step1Company form={form} set={set} />}
          {step === 2 && <Step2Business form={form} set={set} togglePlatform={togglePlatform} />}
          {step === 3 && <Step3Voice form={form} set={set} />}

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
                  if (!validate(step)) { toast.error('Fill in the required fields to continue.'); return; }
                  setStep((n) => Math.min(3, n + 1));
                }}
                className="inline-flex items-center justify-center gap-1 rounded-xl bg-lumi-gold px-5 py-2.5 font-display text-sm font-semibold text-dark-base hover:bg-lumi-deep active:scale-[0.98] shadow-gold-glow transition-all min-w-[120px]"
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
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!validate(step)) { toast.error('Fill in the required fields to continue.'); return; }
                  finish();
                }}
                disabled={busy}
                className="inline-flex items-center justify-center gap-1 rounded-xl bg-lumi-gold px-5 py-2.5 font-display text-sm font-semibold text-dark-base hover:bg-lumi-deep active:scale-[0.98] shadow-gold-glow transition-all disabled:opacity-50 disabled:cursor-not-allowed min-w-[160px] sm:min-w-0"
              >
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Completing…</> : <>Complete &amp; Enter App <ArrowRight className="h-4 w-4" /></>}
              </button>
            </div>
          )}

          {step === 3 && busy && (
            <div className="mt-2 text-center font-mono text-xs text-white/35 animate-pulse">Saving your context…</div>
          )}
        </div>
      </div>
    </div>
  );
}

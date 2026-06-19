import { useState }    from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth }     from '@/context/AuthContext.jsx';
import { toast }       from 'sonner';
import { ArrowRight, ArrowLeft, Loader2, Sparkles } from 'lucide-react';
import { api }                 from '@/lib/api.js';
import { cn }                  from '@/lib/utils.js';
import { primeContextCache }   from '@/router/ProtectedRoute.jsx';
import { STEP_DEFINITIONS, DEFAULTS } from './constants.js';
import { WelcomeStep }         from './steps/WelcomeStep.jsx';
import { IdentityStep }        from './steps/IdentityStep.jsx';
import { IndustryStep }        from './steps/IndustryStep.jsx';
import { AudienceStep }        from './steps/AudienceStep.jsx';
import { VoiceStep }           from './steps/VoiceStep.jsx';
import { ChannelsStep }        from './steps/ChannelsStep.jsx';
import { SpendStep }           from './steps/SpendStep.jsx';
import { ObjectiveStep }       from './steps/ObjectiveStep.jsx';
import { ReviewStep }          from './steps/ReviewStep.jsx';

const STEPS = STEP_DEFINITIONS;

function safeAppPath(value) {
  return typeof value === 'string' && value.startsWith('/app') ? value : null;
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextPath = safeAppPath(searchParams.get('next'));
  const { currentUser } = useAuth();
  const [step, setStep] = useState(0); // 0-indexed: 0 = welcome, 1 = identity, ..., 8 = review
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    ...DEFAULTS,
    name: currentUser?.displayName || '',
  });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const currentStepKey = STEPS[step]?.key;
  const totalSteps = STEPS.length;
  const progress = ((step + 1) / totalSteps) * 100;

  const validate = () => {
    switch (currentStepKey) {
      case 'welcome':
        return true; // No validation needed
      case 'identity':
        return form.name && form.market && form.city;
      case 'industry':
        return form.industry;
      case 'audience':
        return Object.values(form.ages).some(Boolean) && form.gender;
      case 'voice':
        return form.language && form.tone && (form.language === 'en' || form.dialect);
      case 'channels':
        return Object.values(form.channels).some(Boolean);
      case 'spend':
        return form.spendTier;
      case 'objective':
        return form.objective && (form.objective !== 'custom' || form.customObjective);
      case 'review':
        return true;
      default:
        return true;
    }
  };

  const finish = async () => {
    if (busy) return;
    if (!form.name || !form.market || !form.tone) {
      toast.error('Please complete all required fields before finishing.');
      setStep(1); // Go back to identity step
      return;
    }
    setBusy(true);
    try {
      const res = await api.put('/api/campaigns/me/context', {
        context: form,
        email: currentUser?.email,
        workspaceName: form.name || 'My Workspace',
      });
      primeContextCache(res.data?.user?.context ?? form);
      toast.success('Context saved — welcome aboard.');
      await Promise.resolve();
      sessionStorage.setItem('marcom:firstActivation', '1');
      navigate(nextPath || '/app', { replace: true });
    } catch (err) {
      const detail = err.response?.data;
      const msg = detail?.hint || detail?.detail || detail?.error || err.message || 'Could not save context';
      console.error('[onboarding] PUT /me/context failed', detail || err);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const goToStep = (n) => {
    setStep(Math.max(0, Math.min(totalSteps - 1, n)));
  };

  const nextStep = () => {
    if (!validate()) {
      toast.error('Fill in the required fields to continue.');
      return;
    }
    if (step < totalSteps - 1) {
      setStep(step + 1);
    } else {
      finish();
    }
  };

  const prevStep = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  return (
    <div
      className="min-h-screen bg-surface-light text-dark-base overflow-x-hidden"
    >
      <div className="mx-auto max-w-3xl px-3 sm:px-4 py-6 sm:py-8">
        {/* Progress bar */}
        {step > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2.5">
              <span className="font-mono text-[11px] tracking-[0.1em] uppercase text-dark-muted">
                Step {step + 1} of {totalSteps} · {STEPS[step]?.label}
              </span>
              <span className="font-mono text-[11px] text-dark-muted tabular-nums">
                {Math.round(progress)}%
              </span>
            </div>
            <div className="flex gap-1">
              {STEPS.map((s, i) => (
                <div
                  key={s.key}
                  className="flex-1 h-1 rounded-sm transition-all duration-300"
                  style={{
                    backgroundColor: i <= step ? 'var(--c-lumi-accent)' : 'var(--c-surface-border)',
                    boxShadow: i === step ? '0 0 8px rgba(246,201,69,0.5)' : 'none',
                  }}
                />
              ))}
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-surface-border bg-white p-5 sm:p-8 shadow-lg">
          {/* Step content */}
          {currentStepKey === 'welcome' && <WelcomeStep />}
          {currentStepKey === 'identity' && <IdentityStep form={form} set={set} />}
          {currentStepKey === 'industry' && <IndustryStep form={form} set={set} />}
          {currentStepKey === 'audience' && <AudienceStep form={form} set={set} />}
          {currentStepKey === 'voice' && <VoiceStep form={form} set={set} />}
          {currentStepKey === 'channels' && <ChannelsStep form={form} set={set} />}
          {currentStepKey === 'spend' && <SpendStep form={form} set={set} />}
          {currentStepKey === 'objective' && <ObjectiveStep form={form} set={set} />}
          {currentStepKey === 'review' && <ReviewStep form={form} />}

          {/* Navigation */}
          <div className="mt-6 sm:mt-8 flex justify-between gap-2 border-t border-surface-border pt-6">
            <button
              type="button"
              onClick={prevStep}
              disabled={step === 0}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-dark-soft hover:text-dark-base hover:bg-surface-light disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>

            {step < totalSteps - 1 ? (
              <button
                type="button"
                onClick={nextStep}
                className="inline-flex items-center justify-center gap-1 rounded-xl bg-lumi-gold px-5 py-2.5 font-display text-sm font-semibold text-dark-base hover:bg-lumi-deep active:scale-[0.98] shadow-gold-glow transition-all min-w-[120px]"
              >
                Continue <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={finish}
                disabled={busy}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-lumi-accent px-6 py-3 font-display text-sm font-semibold text-dark-base hover:shadow-card-hover active:scale-[0.98] shadow-gold-glow transition-all disabled:opacity-50 disabled:cursor-not-allowed min-w-[180px]"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Launching…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" strokeWidth={2} />
                    Launch Lumi
                    <ArrowRight className="h-4 w-4" strokeWidth={2} />
                  </>
                )}
              </button>
            )}
          </div>

          {busy && (
            <div className="mt-2 text-center font-mono text-xs text-dark-soft animate-pulse">
              Saving your context…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

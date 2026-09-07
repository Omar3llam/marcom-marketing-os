import { CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Section, Field, inputCls, PLATFORMS } from '../shared.jsx';

export function Step2Business({ form, set, togglePlatform }) {
  return (
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
                  : 'border-white/10 bg-white/[0.03] text-white/50 hover:border-white/20 hover:text-white/70',
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
                    : 'border-white/10 bg-white/[0.03] text-white/50 hover:border-white/20',
                )}
              >
                <span>{p.icon}</span>
                <span className="text-xs font-medium">{p.label}</span>
                {active && <CheckCircle2 className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-lumi-gold" />}
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
  );
}

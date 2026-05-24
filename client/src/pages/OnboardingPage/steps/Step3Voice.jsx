import { cn } from '@/lib/utils.js';
import { Section, Field, inputCls, TONES, GOALS } from '../shared.jsx';

export function Step3Voice({ form, set }) {
  return (
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
  );
}

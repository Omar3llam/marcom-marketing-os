import { Globe } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Section, Field, inputCls, INDUSTRIES, MARKETS, LANGUAGES, DIALECT_MAP } from '../shared.jsx';

export function Step1Company({ form, set }) {
  return (
    <Section title="Company basics">
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
                  : 'border-white/10 bg-white/[0.03] text-white/50 hover:border-white/20 hover:text-white/70',
              )}
            >
              {lang}
            </button>
          ))}
        </div>
        {form.dialect && (
          <p className="mt-1.5 text-[11px] text-lumi-gold/70 font-mono">✦ Dialect: {form.dialect}</p>
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
  );
}

// ============================================================
// MARCOM / Lumi — Onboarding Step 7: Review
// ============================================================

import { Sparkles, Layout, Globe, Eye, Send, Wifi, BarChart, Target, TrendingUp, Layers, Brain, Building2 } from 'lucide-react';
import { MARKETS, AGE_BANDS, GENDERS, LANGUAGES, DIALECTS, TONES, CHANNELS, SPEND_TIERS, OBJECTIVES, INDUSTRIES } from '../constants.js';
import { Eyebrow, BigHeader, Lede } from '../shared.jsx';

const OBJECTIVE_ICONS = {
  roas: TrendingUp,
  conversions: Target,
  ltv: Layers,
  custom: Brain,
};

export function ReviewStep({ form }) {
  const market = MARKETS.find((m) => m.id === form.market);
  const gender = GENDERS.find((g) => g.id === form.gender);
  const language = LANGUAGES.find((l) => l.id === form.language);
  const dialect = DIALECTS.find((d) => d.id === form.dialect);
  const tone = TONES.find((t) => t.id === form.tone);
  const spendTier = SPEND_TIERS.find((t) => t.id === form.spendTier);
  const objective = OBJECTIVES.find((o) => o.id === form.objective);
  const industry = INDUSTRIES.find((i) => i.id === form.industry);

  const ages = AGE_BANDS.filter((band) => form.ages[band.id]).map((b) => b.label);
  const interests = Object.keys(form.interests).filter((k) => form.interests[k]);
  const channels = CHANNELS.filter((ch) => form.channels[ch.id]).map((c) => c.label);

  return (
    <div>
      <Eyebrow>Step 9 · Review</Eyebrow>
      <BigHeader>One last look.</BigHeader>
      <Lede>
        Confirm the setup. Lumi will bootstrap with this context and start watching the moment you launch.
      </Lede>

      <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl">
        <ReviewRow label="Brand" icon={Layout} value={form.name || '—'} />
        <ReviewRow label="Industry" icon={Building2} value={industry?.label || '—'} />
        <ReviewRow label="Market" icon={Globe} value={`${market?.label || '—'} · ${form.city}`} />
        <ReviewRow
          label="Audience"
          icon={Eye}
          value={`${ages.join(', ') || '—'} · ${gender?.label || '—'}`}
          sub={interests.join(' · ')}
          wide
        />
        <ReviewRow
          label="Voice"
          icon={Send}
          value={`${language?.label || '—'} · ${dialect?.label || '—'}`}
          sub={tone?.label}
        />
        <ReviewRow label="Channels" icon={Wifi} value={channels.join(' · ') || '—'} />
        <ReviewRow label="Spend" icon={BarChart} value={`${form.currency} ${spendTier?.label || ''}`} />
        <ReviewRow
          label="Objective"
          icon={OBJECTIVE_ICONS[form.objective] || Target}
          value={objective?.label || '—'}
          sub={form.objective === 'custom' ? form.customObjective : objective?.sub}
          wide
        />
      </div>

      <div className="mt-6 p-5 rounded-xl bg-lumi-accent/5 border border-lumi-accent/30 flex gap-3.5 items-start max-w-3xl">
        <Sparkles className="w-5 h-5 text-lumi-accent flex-shrink-0 mt-0.5" strokeWidth={1.5} />
        <div>
          <div className="font-display text-sm font-bold text-dark-base">
            Lumi&apos;s first sweep starts on launch.
          </div>
          <div className="text-xs text-dark-soft mt-1 leading-relaxed">
            We&apos;ll scan your last 30 days and stamp every verdict with cash impact. Lumi will be tuned to
            your audience, voice, and objective from day one.
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewRow({ label, value, sub, icon: Icon, wide }) {
  return (
    <div
      className={`${
        wide ? 'sm:col-span-2' : ''
      } flex gap-3 p-3.5 bg-surface-card border border-surface-border rounded-xl`}
    >
      <div className="w-7 h-7 rounded-lg bg-lumi-accent/10 text-lumi-accent flex items-center justify-center flex-shrink-0">
        <Icon className="w-3.5 h-3.5" strokeWidth={1.5} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-mono text-[10px] tracking-widest uppercase text-dark-muted">
          {label}
        </div>
        <div className="font-display text-sm font-semibold text-dark-base mt-0.5">
          {value}
        </div>
        {sub && (
          <div className="text-xs text-dark-soft mt-0.5">
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

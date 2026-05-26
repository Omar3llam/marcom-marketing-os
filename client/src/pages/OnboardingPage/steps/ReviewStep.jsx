// ============================================================
// MARCOM / Lumi — Onboarding Step 8: Review
// ============================================================

import { CheckCircle2, Edit2 } from 'lucide-react';
import { MARKETS, AGE_BANDS, GENDERS, LANGUAGES, DIALECTS, TONES, CHANNELS, SPEND_TIERS, OBJECTIVES, PLANS } from '../constants.js';
import { BigHeader, Lede } from '../shared.jsx';

export function ReviewStep({ form, onEdit }) {
  const selectedMarket = MARKETS.find((m) => m.id === form.market);
  const selectedGender = GENDERS.find((g) => g.id === form.gender);
  const selectedLanguage = LANGUAGES.find((l) => l.id === form.language);
  const selectedDialect = DIALECTS.find((d) => d.id === form.dialect);
  const selectedTone = TONES.find((t) => t.id === form.tone);
  const selectedSpendTier = SPEND_TIERS.find((t) => t.id === form.spendTier);
  const selectedObjective = OBJECTIVES.find((o) => o.id === form.objective);
  const selectedPlan = PLANS.find((p) => p.id === form.plan);

  const selectedAges = AGE_BANDS.filter((band) => form.ages[band.id]).map((b) => b.label);
  const selectedInterests = Object.keys(form.interests).filter((k) => form.interests[k]);
  const selectedChannels = CHANNELS.filter((ch) => form.channels[ch.id]);

  const sections = [
    {
      step: 1,
      title: 'Workspace identity',
      items: [
        { label: 'Brand name', value: form.name || '—' },
        { label: 'Market', value: selectedMarket?.label || '—' },
        { label: 'City', value: form.city || '—' },
        { label: 'Tag', value: form.tag || 'None' },
      ],
    },
    {
      step: 2,
      title: 'Audience',
      items: [
        { label: 'Age range', value: selectedAges.join(', ') || '—' },
        { label: 'Gender lean', value: selectedGender?.label || '—' },
        { label: 'Interests', value: selectedInterests.join(', ') || 'None' },
      ],
    },
    {
      step: 3,
      title: 'Brand voice',
      items: [
        { label: 'Language', value: selectedLanguage?.label || '—' },
        { label: 'Dialect', value: selectedDialect ? `${selectedDialect.label} (${selectedDialect.sub})` : '—' },
        { label: 'Tone', value: selectedTone?.label || '—' },
      ],
    },
    {
      step: 4,
      title: 'Ad channels',
      items: [
        { label: 'Platforms', value: selectedChannels.map((ch) => ch.label).join(', ') || 'None selected' },
      ],
    },
    {
      step: 5,
      title: 'Budget & objective',
      items: [
        { label: 'Monthly spend', value: selectedSpendTier?.label || '—' },
        { label: 'Objective', value: selectedObjective?.label || '—' },
        ...(form.objective === 'custom' && form.customObjective
          ? [{ label: 'Custom objective', value: form.customObjective }]
          : []),
      ],
    },
    {
      step: 7,
      title: 'Plan',
      items: [
        { label: 'Selected plan', value: selectedPlan?.name || '—' },
        { label: 'Billing', value: form.billing === 'yearly' ? 'Yearly (save 17%)' : 'Monthly' },
      ],
    },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 className="h-6 w-6 text-lumi-gold" />
        <BigHeader className="mb-0">Ready to go</BigHeader>
      </div>

      <Lede className="mb-8">
        Review your setup. You can change any of these settings later from your workspace.
      </Lede>

      <div className="space-y-4">
        {sections.map((section) => (
          <div
            key={section.step}
            className="p-4 rounded-lg bg-white border border-gray-200"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="flex-shrink-0 w-5 h-5 rounded-full bg-lumi-gold/20 flex items-center justify-center text-lumi-gold font-mono text-[10px] font-bold">
                  {section.step}
                </div>
                <h3 className="text-sm font-semibold text-gray-900">
                  {section.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onEdit(section.step)}
                className="inline-flex items-center gap-1 text-xs text-lumi-gold hover:text-lumi-deep transition-colors"
              >
                <Edit2 className="h-3 w-3" />
                Edit
              </button>
            </div>

            <dl className="space-y-2">
              {section.items.map((item, i) => (
                <div key={i} className="flex justify-between gap-4 text-xs">
                  <dt className="text-gray-500 font-medium">{item.label}</dt>
                  <dd className="text-gray-700 text-right">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>

      <div className="mt-6 p-4 rounded-lg bg-lumi-gold/10 border border-lumi-gold/30">
        <div className="text-sm font-medium text-gray-900 mb-1">
          What happens next?
        </div>
        <ol className="text-xs text-gray-700 leading-relaxed space-y-1 list-decimal list-inside">
          <li>We'll create your workspace with these settings</li>
          <li>You'll connect your ad accounts (Meta, Google, etc.)</li>
          <li>Lumi starts analyzing campaigns and generating verdicts</li>
        </ol>
      </div>
    </div>
  );
}

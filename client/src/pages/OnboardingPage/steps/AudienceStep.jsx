// ============================================================
// MARCOM / Lumi — Onboarding Step 2: Audience
// ============================================================

import { AGE_BANDS, GENDERS, INTERESTS } from '../constants.js';
import { BigHeader, Lede, Field, CheckBox, RadioDot, chipBtn } from '../shared.jsx';

export function AudienceStep({ form, set }) {
  const toggleAge = (id) => {
    set('ages', {
      ...form.ages,
      [id]: !form.ages[id],
    });
  };

  const toggleInterest = (interest) => {
    set('interests', {
      ...form.interests,
      [interest]: !form.interests[interest],
    });
  };

  return (
    <div>
      <BigHeader className="mb-3">Who are you reaching?</BigHeader>
      <Lede className="mb-8">
        Help Lumi understand your core audience. You can always refine this later.
      </Lede>

      <div className="space-y-6">
        <Field label="Age range" required>
          <div className="flex flex-wrap gap-2">
            {AGE_BANDS.map((band) => (
              <button
                key={band.id}
                type="button"
                onClick={() => toggleAge(band.id)}
                className={chipBtn(form.ages[band.id])}
              >
                {band.label}
              </button>
            ))}
          </div>
          <div className="mt-2 text-xs text-gray-500">
            Select one or more age ranges
          </div>
        </Field>

        <Field label="Gender lean" required>
          <div className="space-y-2">
            {GENDERS.map((g) => (
              <RadioDot
                key={g.id}
                id={`gender-${g.id}`}
                name="gender"
                checked={form.gender === g.id}
                onChange={() => set('gender', g.id)}
                label={g.label}
              />
            ))}
          </div>
        </Field>

        <Field label="Interests & verticals (optional)">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {INTERESTS.map((interest) => (
              <button
                key={interest}
                type="button"
                onClick={() => toggleInterest(interest)}
                className={chipBtn(form.interests[interest])}
              >
                {interest}
              </button>
            ))}
          </div>
          <div className="mt-2 text-xs text-gray-500">
            Helps Lumi spot signals in your creative and targeting
          </div>
        </Field>
      </div>
    </div>
  );
}

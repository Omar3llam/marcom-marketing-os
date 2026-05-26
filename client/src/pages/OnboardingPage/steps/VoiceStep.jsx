// ============================================================
// MARCOM / Lumi — Onboarding Step 3: Brand Voice
// ============================================================

import { LANGUAGES, DIALECTS, TONES } from '../constants.js';
import { BigHeader, Lede, Field, RadioDot, tileBtn } from '../shared.jsx';

export function VoiceStep({ form, set }) {
  return (
    <div>
      <BigHeader className="mb-3">How does your brand speak?</BigHeader>
      <Lede className="mb-8">
        Language, dialect, and tone shape how Lumi analyzes your creative and writes copy.
      </Lede>

      <div className="space-y-6">
        <Field label="Language" required>
          <div className="space-y-2">
            {LANGUAGES.map((lang) => (
              <RadioDot
                key={lang.id}
                id={`lang-${lang.id}`}
                name="language"
                checked={form.language === lang.id}
                onChange={() => set('language', lang.id)}
                label={lang.label}
              />
            ))}
          </div>
        </Field>

        {form.language !== 'en' && (
          <Field label="Arabic dialect" required>
            <div className="space-y-2">
              {DIALECTS.map((dialect) => (
                <RadioDot
                  key={dialect.id}
                  id={`dialect-${dialect.id}`}
                  name="dialect"
                  checked={form.dialect === dialect.id}
                  onChange={() => set('dialect', dialect.id)}
                  label={dialect.label}
                  sub={dialect.sub}
                />
              ))}
            </div>
          </Field>
        )}

        <Field label="Brand tone" required>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {TONES.map((tone) => (
              <button
                key={tone.id}
                type="button"
                onClick={() => set('tone', tone.id)}
                className={tileBtn(form.tone === tone.id)}
              >
                <div className="text-sm font-semibold text-white/90">
                  {tone.label}
                </div>
                <div className="text-xs text-white/50">
                  {tone.sub}
                </div>
              </button>
            ))}
          </div>
        </Field>
      </div>
    </div>
  );
}

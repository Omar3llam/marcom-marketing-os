// ============================================================
// MARCOM / Lumi — Onboarding Step 6: Objective
// ============================================================

import { OBJECTIVES } from '../constants.js';
import { BigHeader, Lede, Field, tileBtn, textareaBase } from '../shared.jsx';

export function ObjectiveStep({ form, set }) {
  return (
    <div>
      <BigHeader className="mb-3">What does success look like?</BigHeader>
      <Lede className="mb-8">
        This shapes how Lumi scores campaigns and what it optimizes for.
      </Lede>

      <div className="space-y-3">
        {OBJECTIVES.map((obj) => (
          <button
            key={obj.id}
            type="button"
            onClick={() => set('objective', obj.id)}
            className={tileBtn(form.objective === obj.id)}
          >
            <div className="text-sm font-semibold text-white/90">
              {obj.label}
            </div>
            <div className="text-xs text-white/50">
              {obj.sub}
            </div>
          </button>
        ))}
      </div>

      {form.objective === 'custom' && (
        <div className="mt-5">
          <Field label="Describe your custom objective" required>
            <textarea
              value={form.customObjective}
              onChange={(e) => set('customObjective', e.target.value)}
              placeholder="e.g., Maximize app installs with a target CPI under $2.50 in Saudi Arabia"
              rows={4}
              className={textareaBase}
            />
            <div className="mt-1.5 text-xs text-dark-tertiary">
              Be specific — include target metrics, geography, or constraints
            </div>
          </Field>
        </div>
      )}

      <div className="mt-5 p-4 rounded-lg bg-surface-muted border border-surface-border">
        <div className="text-xs font-medium text-dark-secondary mb-1">
          What this means —
        </div>
        <div className="text-xs text-dark-secondary leading-relaxed">
          Lumi will factor your objective into every verdict. For example, if you prioritize ROAS,
          it&apos;ll be more aggressive about killing low-performing creative. If you prioritize conversions,
          it&apos;ll tolerate higher CPAs to drive volume.
        </div>
      </div>
    </div>
  );
}

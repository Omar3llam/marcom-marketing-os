// ============================================================
// MARCOM / Lumi — Onboarding: Industry
// ============================================================
// Single-choice vertical picker (mirrors ObjectiveStep). The choice is
// persisted into the user context and read on the Campaigns page to tailor the
// "needs revenue data" guidance — e-commerce is pointed at GA4/Shopify, services
// at a CRM. It is the one onboarding field wired to live behaviour, not blob-only.

import { INDUSTRIES } from '../constants.js';
import { BigHeader, Lede, tileBtn } from '../shared.jsx';

export function IndustryStep({ form, set }) {
  return (
    <div>
      <BigHeader className="mb-3">What does your business do?</BigHeader>
      <Lede className="mb-8">
        This tells Lumi where to look for revenue — e-commerce stores connect GA4 or Shopify,
        services and B2B businesses connect a CRM. It tailors what Lumi asks you to connect.
      </Lede>

      <div className="space-y-3">
        {INDUSTRIES.map((ind) => (
          <button
            key={ind.id}
            type="button"
            onClick={() => set('industry', ind.id)}
            className={tileBtn(form.industry === ind.id)}
          >
            <div className="text-sm font-semibold text-dark-base">
              {ind.label}
            </div>
            <div className="text-xs text-dark-soft">
              {ind.sub}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

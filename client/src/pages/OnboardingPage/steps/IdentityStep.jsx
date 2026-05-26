// ============================================================
// MARCOM / Lumi — Onboarding Step 1: Workspace Identity
// ============================================================

import { MARKETS } from '../constants.js';
import { BigHeader, Lede, Field, inputBase, selectBase } from '../shared.jsx';

export function IdentityStep({ form, set }) {
  const selectedMarket = MARKETS.find((m) => m.id === form.market);
  const cities = selectedMarket?.cities || [];

  return (
    <div>
      <BigHeader className="mb-3">Tell us about your brand</BigHeader>
      <Lede className="mb-8">
        This creates your first workspace. You can add more brands later.
      </Lede>

      <div className="space-y-5">
        <Field label="Brand or company name" required>
          <input
            type="text"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g., Zara Egypt, Careem, Tamara"
            className={inputBase}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Primary market" required>
            <select
              value={form.market}
              onChange={(e) => {
                const market = MARKETS.find((m) => m.id === e.target.value);
                set('market', e.target.value);
                set('currency', market?.currency || 'EGP');
                set('city', market?.cities[0] || '');
              }}
              className={selectBase}
            >
              {MARKETS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="City" required>
            <select
              value={form.city}
              onChange={(e) => set('city', e.target.value)}
              className={selectBase}
            >
              {cities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Workspace tag (optional)">
          <input
            type="text"
            value={form.tag}
            onChange={(e) => set('tag', e.target.value)}
            placeholder="e.g., Fashion / Q2 / Performance"
            className={inputBase}
          />
          <div className="mt-1.5 text-xs text-dark-tertiary">
            Used to organize workspaces if you manage multiple brands
          </div>
        </Field>
      </div>
    </div>
  );
}

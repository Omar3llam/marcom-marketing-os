// ============================================================
// Unit-economics engine — shared types + frozen thresholds
// ============================================================
// Sibling module so services/routes import the enum without the engine
// (ESM link hygiene — the Phase-5 lesson).
// ============================================================

// Is the current CAC sustainable given the LTV? The question buyers never
// ask but strategists always do.
export const SUSTAINABILITY_BAND = Object.freeze({
  HEALTHY:    'HEALTHY',    // ltv:cac ≥ target (default 3.0)
  THIN:       'THIN',       // 1 ≤ ltv:cac < target
  UNDERWATER: 'UNDERWATER', // ltv:cac < 1 — losing money per customer
});

// The canonical LTV:CAC target. 3.0 is the SaaS/DTC rule of thumb.
export const DEFAULT_TARGET_LTV_TO_CAC = Number(process.env.UNIT_ECON_TARGET_LTV_CAC || 3.0);

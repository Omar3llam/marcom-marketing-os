// ============================================================
// MARCOM / Lumi — IntelligenceContext
// ------------------------------------------------------------
// Single source of truth for all intelligence data in /app tree:
//   - campaigns (feed)
//   - memory (patterns + narratives)
//   - radar alerts
//   - execution state
// Prevents N parallel fetches when N components need the same data.
// Data logic lives in useIntelligenceData.js.
// ============================================================
import { createContext, useContext } from 'react';
import { useIntelligenceData } from '@/hooks/useIntelligenceData.js';

const IntelligenceCtx = createContext(null);

export function IntelligenceProvider({ children }) {
  const value = useIntelligenceData();
  return (
    <IntelligenceCtx.Provider value={value}>
      {children}
    </IntelligenceCtx.Provider>
  );
}

export function useIntelligence() {
  const ctx = useContext(IntelligenceCtx);
  if (!ctx) throw new Error('useIntelligence must be used inside IntelligenceProvider');
  return ctx;
}

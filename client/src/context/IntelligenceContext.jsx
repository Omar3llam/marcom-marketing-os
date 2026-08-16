// ============================================================
// MARCOM / Lumi — IntelligenceContext
// ------------------------------------------------------------
// Single source of truth for all intelligence data in /app tree:
//   - campaigns (feed)
//   (R7 removed a `memory` field here — legacy patterns/narratives that no
//    consumer ever rendered; the sidebar reads canonical Decision history now)
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

// ============================================================
// MARCOM / Lumi — useMemory
// ------------------------------------------------------------
// Delegates to IntelligenceContext for singleton fetch behavior.
// Returns: { patterns, narratives, total, loading, recordDecision }
// ============================================================
import { useIntelligence } from '@/context/IntelligenceContext.jsx';

export function useMemory() {
  const { memory, loading, recordDecision } = useIntelligence();
  return {
    ...memory,
    loading,
    recordDecision,
  };
}

import { KNOWLEDGE } from '@marcom/runtime-contracts';
import { unavailable } from '../attribution-engine/attributionTypes.js';

// No IncrementalityTest row currently persists a denomination or AOV valuation
// basis. Neither current economics nor a workspace currency can establish it.
const REASON = 'INCREMENTALITY_MONETARY_BASIS_UNPROVEN';
const monetaryEvidence = () => ({
  status: 'INSUFFICIENT_EVIDENCE',
  reason: REASON,
  knowledge: KNOWLEDGE.NOT_ENOUGH,
  incrementalRevenueMinor: null,
  currency: null,
});

// Publication only: never mutate the persisted legacy value or causal evidence.
export function projectIncrementalityTest(row) {
  if (!row) return null;
  return { ...row, incrementalRevenueMinor: null, monetary: monetaryEvidence() };
}

export function projectIncrementalityReadout(readout) {
  return {
    ...readout,
    incrementalRevenueMinor: unavailable(REASON, {
      caveat: 'Currency and AOV valuation provenance have not been established.',
    }),
    monetary: monetaryEvidence(),
  };
}

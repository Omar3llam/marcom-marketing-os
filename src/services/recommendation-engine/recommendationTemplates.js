// ============================================================
// Recommendation Engine — static vocabulary definitions
// ============================================================
// Describes what each recommendation type means in human terms.
// Downstream consumers (UI, copy generators, memory layer) use
// these descriptions — they do not invent their own labels.
// ============================================================
import { REC_TYPE } from './recommendationTypes.js';

export const RECOMMENDATION_TEMPLATES = Object.freeze({
  [REC_TYPE.REFRESH_HOOK]: {
    label:       'Refresh Creative Hook',
    description: 'Rewrite the opening 3 seconds of the creative to recapture attention before drop-off.',
  },
  [REC_TYPE.ROTATE_CREATIVE]: {
    label:       'Rotate Creative',
    description: 'Introduce a new creative variant to reset audience fatigue.',
  },
  [REC_TYPE.TEST_NEW_ANGLE]: {
    label:       'Test New Audience Angle',
    description: 'Experiment with a different message or audience segment to find a better fit.',
  },
  [REC_TYPE.REDUCE_BUDGET]: {
    label:       'Reduce Budget',
    description: 'Scale back spend until cost-per-conversion stabilizes within target range.',
  },
  [REC_TYPE.DUPLICATE_WINNER]: {
    label:       'Duplicate Winning Ad Set',
    description: 'Clone this ad set to scale spend on a proven performer.',
  },
  [REC_TYPE.HOLD_STEADY]: {
    label:       'Hold Steady',
    description: 'No action required. Continue monitoring and let the campaign run.',
  },
});

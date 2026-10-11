import { GATING_REASONS } from '@marcom/runtime-contracts';
import { absenceState } from '@/design-system/states/absence.js';

// Credential evidence only: this says nothing about sync health or verdicts.
export function hasConfirmedMetaConnection({ data, loading, error }) {
  if (loading !== false || error || typeof data?.workspaceId !== 'string' || !data.workspaceId.trim()) return false;
  if (!Array.isArray(data.connections)) return false;
  const meta = data.connections.filter((row) => row.platform === 'META');
  return meta?.length === 1 && meta[0].connected === true && meta[0].isActive !== false
    && (meta[0].connection == null || meta[0].connection === 'CONNECTED');
}

const REFUSALS = {
  denied: { message: 'Meta permissions weren’t granted.', retryable: true },
  access_denied: { message: 'Meta permissions weren’t granted.', retryable: true },
  server_error: { message: 'Something went wrong on our end.', retryable: true },
  project_not_found: { message: 'We couldn’t find the project for this connection. Review your workspace setup before connecting.', retryable: false },
  invalid_state: { message: 'The connection session expired. Start a new connection attempt.', retryable: true },
  role_forbidden: { message: 'A current workspace Strategist is required to connect Meta. Ask a workspace Strategist to continue.', retryable: false },
  authority_unavailable: { message: 'We couldn’t confirm connection permissions. Try again shortly.', retryable: true },
  workspace_unavailable: { message: 'The workspace is unavailable. Review your workspace setup before connecting.', retryable: false },
  workspace_mismatch: { message: 'Your workspace changed during the connection attempt. Review your current workspace before connecting.', retryable: false },
  incomplete_connection: { message: 'Meta did not provide a usable Meta ad account. Review account access before starting another attempt.', retryable: true },
  auth_required: { message: 'Your session needs authentication. Sign in again before starting a connection.', retryable: false },
  start_forbidden: { message: 'You do not have permission to start this connection. Ask a workspace Strategist to continue.', retryable: false },
  start_unavailable: { message: 'The connection service is unavailable. Try again shortly.', retryable: true },
  start_network: { message: 'We couldn’t reach the connection service. Check your connection and try again.', retryable: true },
  start_failed: { message: 'The connection request did not provide a redirect. You can start another connection attempt.', retryable: true },
};
const UNKNOWN_REFUSAL = { message: 'The connection didn’t complete. Review it later from Settings.', retryable: false };

export function connectionRefusal(code) {
  return Object.hasOwn(REFUSALS, code) ? REFUSALS[code] : UNKNOWN_REFUSAL;
}

export function connectStartFailure(error) {
  const status = error?.httpStatus ?? error?.response?.status;
  if (status === 401) return 'auth_required';
  if (status === 403) return 'start_forbidden';
  if (status === 503) return 'start_unavailable';
  if (status >= 500) return 'server_error';
  return status == null ? 'start_network' : 'start_unknown';
}

const ASSESSMENT_STATES = {
  NO_WORKSPACE: { heading: 'Workspace unavailable for assessment.', message: 'No workspace was supplied for this assessment.' },
  NO_CAMPAIGNS: { heading: 'No campaigns in the assessment result.', message: 'No campaigns were reported for this assessment.' },
  NO_ELIGIBLE_CAMPAIGNS: { heading: 'No eligible campaign assessment.', message: 'No campaigns were reported as eligible for a verdict.' },
  OK: { heading: 'No KILL or SCALE call returned.', message: 'No KILL or SCALE call was supplied in this assessment result.' },
};
const UNKNOWN_ASSESSMENT = { heading: 'Assessment availability is unknown.', message: 'Assessment availability could not be confirmed.' };
const GATE_COPY = {
  NO_MEASURABLE_DELIVERY: { message: 'No measurable delivery over the verdict window.', prerequisite: 'A verdict requires measurable delivery and a revenue source to measure it against.' },
  NO_CANONICAL_WINDOW: { message: 'No canonical measurement window was supplied.', prerequisite: 'A verdict requires a first canonical measurement over the verdict window.' },
  CANONICAL_EVIDENCE_STALE: { message: 'Canonical evidence is stale for the current assessment.', prerequisite: 'A verdict requires a fresh canonical measurement.' },
};

// The registry validates the published tuple; the locked absence adapter owns
// knowledge-to-state mapping. Missing, future or inconsistent fields stay unknown.
export function readyEvidenceState(status, gatedOut) {
  const assessment = Object.hasOwn(ASSESSMENT_STATES, status) ? ASSESSMENT_STATES[status] : UNKNOWN_ASSESSMENT;
  const gates = Array.isArray(gatedOut) ? gatedOut.map((row) => {
    const declaration = GATING_REASONS.declarationOf(row.reason);
    if (!declaration || !Object.hasOwn(GATE_COPY, row.reason) || row.knowledge !== declaration.knowledge || row.prerequisite !== declaration.prerequisite) {
      return { row, state: 'UNKNOWN', message: 'This campaign’s assessment availability could not be confirmed.' };
    }
    return { row, state: absenceState(row), ...GATE_COPY[row.reason] };
  }) : [];
  return { ...assessment, gates };
}

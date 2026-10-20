// 03B-2A candidate only. No runtime caller, probe implementation or activation.
// Trust is an explicitly injected synthetic qualification registry, separate from
// untrusted evidence. Real issuers, freshness and permission policies are undefined
// and must be independently approved/implemented in a later bounded slice.
const definition = (id, coverage) => Object.freeze({ id, coverage: Object.freeze(coverage) });
const common = Object.freeze([
  definition('IDENTITY', ['server_database_identity', 'session_runtime_role', 'effective_inherited_privileges', 'no_ddl_or_role_administration', 'tenant_permission_boundaries']),
  definition('LEGACY_NATIVE', ['sealed_source_manifest', 'exact_native_catalog', 'owners_acl_defaults', 'prerequisite_keys']),
  definition('CANONICAL_76', ['four_native_tables', 'composite_tenant_fks', 'native_functions_triggers_seals', 'owners_acl_roles', 'migration76_history']),
  definition('MIGRATION_HISTORY', ['all_shipped_checksums', 'complete_success_receipts', 'failed_rolled_back_duplicate_extra_receipts', 'migration76_history']),
  definition('AUTH', ['firebase_auth_configuration', 'workspace_authorization', 'tenant_isolation']),
]);
const compatibility = definition('BINARY_COMPATIBILITY', ['current_binary_contract', 'old_new_web_worker_matrix', 'rolling_read_write_compatibility']);
const requirements = Object.freeze({
  API: Object.freeze([...common,
    definition('API_SESSIONS_OAUTH_CREDENTIALS', ['session_history_touch', 'legacy_context_project_transition', 'oauth_callback_state', 'vault_key_decrypt_contract', 'workspace_account_selection', 'no_automatic_reconciliation']),
    compatibility]),
  WORKER: Object.freeze([...common,
    definition('WORKER_CREDENTIALS', ['vault_key_decrypt_contract', 'workspace_account_selection', 'no_automatic_reconciliation']),
    definition('WORKER_EFFECTS', ['queue_identity_permissions', 'all_consumers_schedules_admission', 'execution_gate_preserved', 'no_provider_action_during_probe', 'startup_maintenance_delete_boundary']),
    compatibility]),
});
const empty = Object.freeze([]);
export const admissionRequirements = kind => typeof kind === 'string' && Object.hasOwn(requirements, kind) ? requirements[kind] : empty;

// Policy inventory only: names are never looked up or invoked. Existing startup
// still invokes these; changing that behavior is explicitly outside this slice.
export const forbiddenAutomaticWork = Object.freeze([
  'ensureChatSessionSchema', 'ensureUserContextSchema', 'ensureProjectSchema',
  'ensureCredentialSchema', 'backfillWorkspaceIds',
]);

const bindingKeys = Object.freeze(['target', 'role', 'binary', 'observation']);
const validBinding = value => value && bindingKeys.every(key => typeof value[key] === 'string' && /^[a-f0-9]{64}$/.test(value[key]));
const finiteTime = value => Number.isSafeInteger(value) && value >= 0;
const statuses = Object.freeze(['UNKNOWN', 'NOT_CONNECTED', 'FAILED', 'INCOMPATIBLE']);
const base = Object.freeze({ contract: 'STARTUP_ADMISSION_CANDIDATE_V1', scope: 'SYNTHETIC_ONLY', integration: 'BLOCKED', runtimeAdmission: 'NOT_WIRED' });
const result = (status, reason, proofs = [], processKind = 'UNQUALIFIED') => ({ ...base, processKind, status, reason, proofs });
const refused = (id, status, reason) => ({ id, status, reason, issuer: 'UNQUALIFIED', coverage: [] });

function inspect(requirement, input, trust) {
  const { id, coverage } = requirement;
  const token = input.proofs?.[id];
  if (token === undefined) return refused(id, 'UNKNOWN', 'PROOF_MISSING');
  // Object identity is deliberate: serialized or copied claims have no authority.
  const proof = trust.receipts.get(token);
  if (!proof || proof.issuer !== 'SYNTHETIC_READ_ONLY_FIXTURE' || proof.readOnly !== true
    || proof.kind !== input.kind || proof.requirement !== id) return refused(id, 'UNKNOWN', 'PROOF_UNQUALIFIED');
  if (!validBinding(proof.binding) || bindingKeys.some(key => proof.binding[key] !== trust.binding[key])) {
    return refused(id, 'INCOMPATIBLE', 'BINDING_MISMATCH');
  }
  if (!finiteTime(proof.observedAt) || !finiteTime(proof.expiresAt)
    || proof.observedAt > input.now || proof.expiresAt <= input.now
    || input.now - proof.observedAt > trust.maxAgeMs) return refused(id, 'UNKNOWN', 'PROOF_NOT_CURRENT');
  const provenance = { issuer: 'SYNTHETIC_READ_ONLY_FIXTURE' };
  if (statuses.includes(proof.status)) return { ...refused(id, proof.status, `PROBE_${proof.status}`), ...provenance };
  if (proof.status !== 'COMPATIBLE') return refused(id, 'UNKNOWN', 'PROOF_UNQUALIFIED');
  if (!Array.isArray(proof.coverage) || coverage.some(key => !proof.coverage.includes(key))) {
    return { ...refused(id, 'UNKNOWN', 'COVERAGE_INCOMPLETE'), ...provenance };
  }
  if (['LEGACY_NATIVE', 'CANONICAL_76'].includes(id) && proof.nativeMatch !== 'EXACT') {
    return { ...refused(id, 'INCOMPATIBLE', 'NATIVE_CATALOG_MISMATCH'), ...provenance };
  }
  if (['CANONICAL_76', 'MIGRATION_HISTORY'].includes(id)
    && (proof.migration76 !== 'APPLIED' || proof.history !== 'COMPLETE_SUCCESS')) {
    return { ...refused(id, 'INCOMPATIBLE', 'MIGRATION_HISTORY_UNQUALIFIED'), ...provenance };
  }
  // Only controlled enums/coverage are returned, never bindings, errors or claim data.
  return { id, status: 'READY', reason: 'SYNTHETIC_PROOF_QUALIFIED', ...provenance, coverage: [...coverage] };
}

/**
 * Pure, deterministic evaluation of already-observed synthetic proof results.
 * input: {kind: API|WORKER, now: integer milliseconds, proofs: {requirement: token}}
 * trust: {context: SYNTHETIC, binding: four opaque SHA256 values, maxAgeMs,
 *         receipts: Map(token -> independently constructed fixture receipt)}
 * The trust argument is test infrastructure authority, NOT operator JSON. There
 * is no production qualification registry. Passing an object/boolean/diagnostic
 * as an input proof cannot create a qualified receipt. A caller able to replace
 * trusted code can forge a simulation; this is not a cryptographic attestation.
 * READY is a synthetic candidate outcome, never permission to run a live program.
 * No clock, I/O, probe callback, logging or side-effect function is invoked here.
 */
export function evaluateStartupAdmission(input = {}, trust = {}) {
  try {
    if (trust?.context !== 'SYNTHETIC') return result('UNKNOWN', 'REAL_PROOF_SOURCES_UNDEFINED');
    if (!input || !admissionRequirements(input.kind).length || !finiteTime(input.now)
      || !validBinding(trust.binding) || !Number.isSafeInteger(trust.maxAgeMs) || trust.maxAgeMs <= 0
      || !(trust.receipts instanceof Map)) return result('UNKNOWN', 'QUALIFICATION_CONTEXT_INVALID');
    const proofs = admissionRequirements(input.kind).map(requirement => inspect(requirement, input, trust));
    // Preserve each leaf state. Deterministic aggregate precedence does not erase
    // an unknown or disconnected dependency when a different one has failed.
    const status = ['INCOMPATIBLE', 'FAILED', 'NOT_CONNECTED', 'UNKNOWN'].find(value => proofs.some(p => p.status === value)) || 'READY';
    return result(status, status === 'READY' ? 'SYNTHETIC_PRECONDITIONS_COMPLETE' : 'PRECONDITIONS_NOT_MET', proofs, input.kind);
  } catch {
    return result('UNKNOWN', 'MALFORMED_EVIDENCE');
  }
}

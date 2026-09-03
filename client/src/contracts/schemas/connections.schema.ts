/**
 * Connections Schema — Phase 12 connector status (display fields ONLY)
 *
 * Reads the Integration connection record's DISPLAY-safe fields + the
 * connector-health summary. Tokens (accessToken/refreshToken) are NEVER part of
 * this contract — they are excluded server-side by a typed select.
 *
 * Source of truth: schema (runtime validation). Types are inferred.
 */

import { z } from 'zod';

export const ConnectorHealthSchema = z.object({
  platform: z.string().nullish(),
  lastSuccessfulSync: z.string().nullish(),
  lastAttemptedSync: z.string().nullish(),
  lastError: z.string().nullish(),
  // C-04 · D-1 — a SUCCESSFUL sync that landed knowingly incomplete data (e.g.
  // an account with more ad sets than the pagination ceiling). The server has
  // written it on every sync since connector health existed and puts it on the
  // wire, but this schema did not declare it — and `z.object` strips what it
  // does not declare, so no component could ever have rendered it however it
  // was written. The account owner was the one person not told their figures
  // were short; the admin drill-down showed it all along.
  //
  // This is why the defect was a CONTRACT defect and not a UI one: fixing the
  // component alone would have rendered `undefined`.
  lastWarning: z.string().nullish(),
  recordsImported: z.number().nullish(),
  // What each capability's last recorded run did, keyed by capability name.
  // Absent on every row synced before C-04, which the projection reports as
  // NOT_RECORDED rather than inventing an outcome for.
  capabilities: z.record(z.string(), z.string()).nullish(),
});

// ── C-04 · the five axes ────────────────────────────────────────────────────
// Declared as plain strings rather than enums ON PURPOSE. A client that hard
// -codes the server's value set starts refusing payloads the moment the server
// learns a sixth state — and a contract-validation failure renders as "we could
// not load your channels", which is a worse lie than an unfamiliar word. The
// components below switch on the values they know and fall through honestly.
const AxisSchema = z.string().nullish();

export const CapabilitySchema = z.object({
  capability: z.string(),
  // Structural: can this connector be ASKED at all? `false` is fixed by
  // building a connector, and is never the same claim as "no data".
  implemented: z.boolean(),
  // What the last recorded run did. NOT_RECORDED (exercised, nothing stored)
  // and NOT_APPLICABLE (not exercised by the sync loop) are different absences
  // and neither is NO_DATA, which is a measurement.
  lastRun: z.string(),
});

// An ad account the connected token proves access to — powers the account picker.
export const AdAccountSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
});

export const ConnectionSchema = z.object({
  platform: z.string(),
  isActive: z.boolean(),
  connected: z.boolean(),
  stale: z.boolean(),
  lastSyncedAt: z.string().nullish(),
  accountId: z.string().nullish(),
  availableAccounts: z.array(AdAccountSchema).nullish(),
  health: ConnectorHealthSchema.nullish(),

  // C-04. All five are `nullish` so a server that has not deployed the
  // projection yet still validates — an additive contract, never a gate.
  connection:   AxisSchema,
  availability: AxisSchema,
  completeness: AxisSchema,
  readiness:    AxisSchema,
  capabilities: z.array(CapabilitySchema).nullish(),
});

export const ConnectionsResponseSchema = z.object({
  workspaceId: z.string().nullish(),
  connections: z.array(ConnectionSchema),
});

export type ConnectorHealth = z.infer<typeof ConnectorHealthSchema>;
export type AdAccount = z.infer<typeof AdAccountSchema>;
export type Connection = z.infer<typeof ConnectionSchema>;
export type ConnectionsResponse = z.infer<typeof ConnectionsResponseSchema>;

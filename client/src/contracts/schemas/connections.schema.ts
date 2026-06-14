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
  recordsImported: z.number().nullish(),
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
});

export const ConnectionsResponseSchema = z.object({
  workspaceId: z.string().nullish(),
  connections: z.array(ConnectionSchema),
});

export type ConnectorHealth = z.infer<typeof ConnectorHealthSchema>;
export type AdAccount = z.infer<typeof AdAccountSchema>;
export type Connection = z.infer<typeof ConnectionSchema>;
export type ConnectionsResponse = z.infer<typeof ConnectionsResponseSchema>;

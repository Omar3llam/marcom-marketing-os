/**
 * Entity Graph Schema — normalized marketing entity contracts
 *
 * Mirrors the Phase 1 Prisma entity graph:
 *   Account → Campaign → AdSet → Ad → Creative
 *
 * Node schemas are suffixed `…Node` to avoid colliding with the
 * existing health `CampaignSchema` in campaign.schema.ts.
 *
 * Source of truth: schemas (runtime validation). Types are inferred.
 */

import { z } from 'zod';

/** Platform an entity physically lives on. */
export const ChannelSchema = z.enum(['META', 'GOOGLE', 'TIKTOK', 'SNAP', 'LINKEDIN']);

/** Level of an entity in the normalized graph. */
export const EntityLevelSchema = z.enum(['ACCOUNT', 'CAMPAIGN', 'ADSET', 'AD', 'CREATIVE']);

/** Lifecycle status of an entity. */
export const EntityStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']);

/** Fields common to every node in the entity graph. */
const baseEntityShape = {
  id: z.string().min(1, 'Entity id required'),
  workspaceId: z.string().min(1, 'Workspace id required'),
  channel: ChannelSchema,
  status: EntityStatusSchema,
  name: z.string(),
  externalId: z.string().nullish(),
};

export const AccountNodeSchema = z.object({
  ...baseEntityShape,
  // Account has no parent.
});

export const CampaignNodeSchema = z.object({
  ...baseEntityShape,
  accountId: z.string().min(1, 'Parent account id required'), // parentId
});

export const AdSetNodeSchema = z.object({
  ...baseEntityShape,
  campaignId: z.string().min(1, 'Parent campaign id required'), // parentId
});

export const AdNodeSchema = z.object({
  ...baseEntityShape,
  adSetId: z.string().min(1, 'Parent ad set id required'), // parentId
});

export const CreativeNodeSchema = z.object({
  ...baseEntityShape,
  adId: z.string().min(1, 'Parent ad id required'), // parentId
});

export type Channel = z.infer<typeof ChannelSchema>;
export type EntityLevel = z.infer<typeof EntityLevelSchema>;
export type EntityStatus = z.infer<typeof EntityStatusSchema>;
export type AccountNode = z.infer<typeof AccountNodeSchema>;
export type CampaignNode = z.infer<typeof CampaignNodeSchema>;
export type AdSetNode = z.infer<typeof AdSetNodeSchema>;
export type AdNode = z.infer<typeof AdNodeSchema>;
export type CreativeNode = z.infer<typeof CreativeNodeSchema>;

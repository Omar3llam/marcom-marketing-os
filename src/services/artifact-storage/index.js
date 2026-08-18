// ============================================================
// Artifact Storage Service — persistent AI artifact storage
// ============================================================
// Stores AI-generated artifacts (hooks, captions, visual briefs)
// with metadata, versioning, and retrieval capabilities.
//
// ADAPTERS:
//   - localAdapter: filesystem storage (dev/test)
//   - s3Adapter: S3 storage (production)
//
// OPERATIONS:
//   - storeArtifact(artifact, metadata) → { id, storageKey }
//   - getArtifact(artifactId, workspaceId) → artifact + metadata
//   - listArtifacts(filters) → artifacts[]
//   - deleteArtifact(artifactId, workspaceId) → void
//
// VERSIONING:
//   Artifacts are immutable. Updates create new versions.
// ============================================================
import crypto from 'crypto';
// R11 (F26): shared Prisma client — this module used to open its own pool.
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { createLocalAdapter } from './adapters/localAdapter.js';
import { createS3Adapter } from './adapters/s3Adapter.js';


// Select adapter based on environment
const ADAPTER_TYPE = process.env.ARTIFACT_STORAGE_ADAPTER || 'local';
const adapter = ADAPTER_TYPE === 's3' ? createS3Adapter() : createLocalAdapter();

logger.info({ adapter: ADAPTER_TYPE }, '[ArtifactStorage] initialized');

// ============================================================
// Store artifact with metadata
// ============================================================

export async function storeArtifact({
  workspaceId,
  executionId,
  nodeId,
  nodeType,
  type,
  content,
  capability,
  provider,
  metadata = {},
}) {
  try {
    // Calculate content hash for deduplication
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    const size = Buffer.byteLength(content, 'utf8');

    // Check for duplicate by hash (optional optimization)
    const existing = await prisma.artifact.findFirst({
      where: {
        workspaceId,
        executionId,
        nodeId,
        contentHash,
      },
    });

    if (existing) {
      logger.debug(
        { artifactId: existing.id, contentHash },
        '[ArtifactStorage] duplicate artifact detected, skipping storage'
      );
      return { id: existing.id, storageKey: existing.storageKey, duplicate: true };
    }

    // Determine version (increment if same nodeId exists)
    const previousVersion = await prisma.artifact.findFirst({
      where: { workspaceId, executionId, nodeId },
      orderBy: { version: 'desc' },
    });

    const version = previousVersion ? previousVersion.version + 1 : 1;

    // Generate storage key
    const storageKey = generateStorageKey({
      workspaceId,
      executionId,
      nodeId,
      type,
      version,
    });

    // Store content via adapter
    await adapter.write(storageKey, content);

    // Store metadata in database
    const artifact = await prisma.artifact.create({
      data: {
        workspaceId,
        executionId,
        nodeId,
        nodeType,
        type,
        storageKey,
        capability,
        provider,
        version,
        size,
        contentHash,
        content: size < 1024 ? content : null, // Store inline if < 1KB
        metadata: metadata || {},
      },
    });

    logger.debug(
      {
        artifactId: artifact.id,
        type,
        version,
        size,
        provider,
      },
      '[ArtifactStorage] artifact stored'
    );

    return {
      id: artifact.id,
      storageKey: artifact.storageKey,
      version: artifact.version,
      duplicate: false,
    };
  } catch (error) {
    logger.error(
      {
        error: error.message,
        workspaceId,
        executionId,
        nodeId,
      },
      '[ArtifactStorage] failed to store artifact'
    );
    throw error;
  }
}

// ============================================================
// Retrieve artifact by ID
// ============================================================

/**
 * Retrieve one artifact, WITH its content, inside a workspace.
 *
 * R9 (I40) — workspaceId is a required parameter of the resolver, not a check
 * the caller performs afterwards. Every caller already compared
 * `artifact.workspaceId` to its own once it had the row; that is authorization
 * bolted onto a global read, and it only holds while every caller remembers to
 * do it. Scoping the query makes a cross-workspace artifact simply not exist —
 * and, because this function also READS THE CONTENT out of the storage adapter,
 * the previous shape fetched the bytes of a foreign artifact before anyone
 * checked who owned it.
 *
 * @param {string} artifactId
 * @param {string} workspaceId — required; the owning workspace
 * @returns {Promise<object|null>} null when absent OR owned by another workspace
 */
export async function getArtifact(artifactId, workspaceId) {
  if (!workspaceId) throw new Error('getArtifact: workspaceId required');
  try {
    const artifact = await prisma.artifact.findFirst({
      where: { id: artifactId, workspaceId },
    });

    if (!artifact) {
      return null;
    }

    // If content stored inline, return it
    if (artifact.content) {
      return {
        ...artifact,
        content: artifact.content,
      };
    }

    // Otherwise, fetch from adapter
    const content = await adapter.read(artifact.storageKey);

    return {
      ...artifact,
      content,
    };
  } catch (error) {
    logger.error(
      { error: error.message, artifactId },
      '[ArtifactStorage] failed to retrieve artifact'
    );
    throw error;
  }
}

// ============================================================
// List artifacts with filters
// ============================================================

export async function listArtifacts({
  workspaceId,
  executionId,
  nodeId,
  type,
  limit = 100,
  offset = 0,
}) {
  try {
    const where = {};

    if (workspaceId) where.workspaceId = workspaceId;
    if (executionId) where.executionId = executionId;
    if (nodeId) where.nodeId = nodeId;
    if (type) where.type = type;

    const artifacts = await prisma.artifact.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    return artifacts;
  } catch (error) {
    logger.error(
      { error: error.message, workspaceId, executionId },
      '[ArtifactStorage] failed to list artifacts'
    );
    throw error;
  }
}

// ============================================================
// Delete artifact (soft delete - keeps metadata)
// ============================================================

/**
 * R9 (I40) — same workspace contract as getArtifact, and more load-bearing: this
 * one MUTATES. It resolved an artifact by id alone and then deleted its stored
 * content, so a foreign id would have destroyed another workspace's bytes rather
 * than merely reading them. Scoped, an artifact outside the workspace is simply
 * not found and returns false.
 *
 * @param {string} artifactId
 * @param {string} workspaceId — required; the owning workspace
 */
export async function deleteArtifact(artifactId, workspaceId) {
  if (!workspaceId) throw new Error('deleteArtifact: workspaceId required');
  try {
    const artifact = await prisma.artifact.findFirst({
      where: { id: artifactId, workspaceId },
    });

    if (!artifact) {
      return false;
    }

    // Delete content from adapter
    await adapter.delete(artifact.storageKey);

    // Soft delete: clear content but keep metadata
    await prisma.artifact.update({
      where: { id: artifactId },
      data: {
        content: null,
        metadata: {
          ...artifact.metadata,
          deletedAt: new Date().toISOString(),
        },
      },
    });

    logger.debug({ artifactId }, '[ArtifactStorage] artifact deleted');

    return true;
  } catch (error) {
    logger.error(
      { error: error.message, artifactId },
      '[ArtifactStorage] failed to delete artifact'
    );
    throw error;
  }
}

// ============================================================
// Helpers
// ============================================================

function generateStorageKey({ workspaceId, executionId, nodeId, type, version }) {
  // Format: workspace_id/execution_id/node_id/type_v{version}.json
  return `${workspaceId}/${executionId}/${nodeId}/${type}_v${version}.json`;
}

// ============================================================
// Health check
// ============================================================

export async function healthCheck() {
  try {
    await adapter.healthCheck();
    return { healthy: true, adapter: ADAPTER_TYPE };
  } catch (error) {
    logger.error(
      { error: error.message },
      '[ArtifactStorage] health check failed'
    );
    return { healthy: false, adapter: ADAPTER_TYPE, error: error.message };
  }
}

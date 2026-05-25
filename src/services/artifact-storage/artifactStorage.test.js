// ============================================================
// Artifact Storage Service — Test Suite
// ============================================================
// Tests storage, retrieval, versioning, and deduplication.
// ============================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Mock Prisma FIRST, before importing the module being tested
// Export reset function to clear mock state between tests
let mockArtifacts = new Map();
let idCounter = 1;

export function resetMockArtifacts() {
  mockArtifacts.clear();
  idCounter = 1;
}

vi.mock('@prisma/client', () => {
  return {
    PrismaClient: vi.fn(function() {
      return {
      artifact: {
        findFirst: vi.fn(async ({ where, orderBy }) => {
          const artifacts = Array.from(mockArtifacts.values());

          // Filter by criteria
          let filtered = artifacts.filter(a => {
            if (where.workspaceId && a.workspaceId !== where.workspaceId) return false;
            if (where.executionId && a.executionId !== where.executionId) return false;
            if (where.nodeId && a.nodeId !== where.nodeId) return false;
            if (where.contentHash && a.contentHash !== where.contentHash) return false;
            return true;
          });

          // Sort by version descending if requested
          if (orderBy?.version === 'desc') {
            filtered.sort((a, b) => b.version - a.version);
          }

          return filtered[0] || null;
        }),

        create: vi.fn(async ({ data }) => {
          const artifact = {
            id: `artifact_${idCounter++}`,
            ...data,
            createdAt: new Date(),
          };
          mockArtifacts.set(artifact.id, artifact);
          return artifact;
        }),

        findUnique: vi.fn(async ({ where }) => {
          return mockArtifacts.get(where.id) || null;
        }),

        findMany: vi.fn(async ({ where, orderBy, take, skip }) => {
          let artifacts = Array.from(mockArtifacts.values());

          // Filter
          if (where) {
            artifacts = artifacts.filter(a => {
              if (where.workspaceId && a.workspaceId !== where.workspaceId) return false;
              if (where.executionId && a.executionId !== where.executionId) return false;
              if (where.nodeId && a.nodeId !== where.nodeId) return false;
              if (where.type && a.type !== where.type) return false;
              return true;
            });
          }

          // Sort
          if (orderBy?.createdAt === 'desc') {
            artifacts.sort((a, b) => b.createdAt - a.createdAt);
          }

          // Paginate
          if (skip) artifacts = artifacts.slice(skip);
          if (take) artifacts = artifacts.slice(0, take);

          return artifacts;
        }),

        update: vi.fn(async ({ where, data }) => {
          const artifact = mockArtifacts.get(where.id);
          if (!artifact) return null;

          Object.assign(artifact, data);
          return artifact;
        }),
      },
      };
    }),
  };
});

// NOW import the module after mock is registered
import { storeArtifact, getArtifact, listArtifacts, deleteArtifact, healthCheck } from './index.js';
import fs from 'fs/promises';
import path from 'path';

// Test data
const TEST_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
const TEST_EXECUTION_ID = 'test_execution_001';
const TEST_NODE_ID = 'node_generate_hooks';
const TEST_NODE_TYPE = 'GENERATE_HOOK_VARIANTS';

describe('Artifact Storage Service', () => {
  beforeEach(async () => {
    // Clear mock artifacts before each test
    resetMockArtifacts();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    // Cleanup test artifacts directory
    try {
      await fs.rm('./artifacts', { recursive: true });
    } catch (error) {
      // Ignore errors if directory doesn't exist
    }
  });

  it('should store artifact with metadata', async () => {
    const result = await storeArtifact({
      workspaceId: TEST_WORKSPACE_ID,
      executionId: TEST_EXECUTION_ID,
      nodeId: TEST_NODE_ID,
      nodeType: TEST_NODE_TYPE,
      type: 'hook',
      content: 'Stop scrolling past your best customers',
      capability: 'GENERATE_HOOKS',
      provider: 'CLAUDE',
      metadata: {
        tokens: 150,
        latency: 1200,
        requestId: 'test_req_001',
      },
    });

    expect(result.id).toBeDefined();
    expect(result.storageKey).toBeDefined();
    expect(result.version).toBe(1);
    expect(result.duplicate).toBe(false);
  });

  it('should detect duplicate artifacts by content hash', async () => {
    const artifactData = {
      workspaceId: TEST_WORKSPACE_ID,
      executionId: TEST_EXECUTION_ID,
      nodeId: TEST_NODE_ID,
      nodeType: TEST_NODE_TYPE,
      type: 'hook',
      content: 'Same content for dedup test',
      capability: 'GENERATE_HOOKS',
      provider: 'CLAUDE',
    };

    // Store first time
    const result1 = await storeArtifact(artifactData);
    expect(result1.duplicate).toBe(false);

    // Store second time (same content)
    const result2 = await storeArtifact(artifactData);
    expect(result2.duplicate).toBe(true);
    expect(result2.id).toBe(result1.id); // Same artifact
  });

  it('should increment version for same nodeId', async () => {
    // Store v1
    const result1 = await storeArtifact({
      workspaceId: TEST_WORKSPACE_ID,
      executionId: TEST_EXECUTION_ID,
      nodeId: TEST_NODE_ID,
      nodeType: TEST_NODE_TYPE,
      type: 'hook',
      content: 'Version 1 content',
      capability: 'GENERATE_HOOKS',
      provider: 'CLAUDE',
    });

    expect(result1.version).toBe(1);

    // Store v2 (different content)
    const result2 = await storeArtifact({
      workspaceId: TEST_WORKSPACE_ID,
      executionId: TEST_EXECUTION_ID,
      nodeId: TEST_NODE_ID,
      nodeType: TEST_NODE_TYPE,
      type: 'hook',
      content: 'Version 2 content',
      capability: 'GENERATE_HOOKS',
      provider: 'CLAUDE',
    });

    expect(result2.version).toBe(2);
    expect(result2.duplicate).toBe(false);
  });

  it('should retrieve artifact by ID', async () => {
    const stored = await storeArtifact({
      workspaceId: TEST_WORKSPACE_ID,
      executionId: TEST_EXECUTION_ID,
      nodeId: TEST_NODE_ID,
      nodeType: TEST_NODE_TYPE,
      type: 'hook',
      content: 'Test retrieval content',
      capability: 'GENERATE_HOOKS',
      provider: 'CLAUDE',
    });

    const retrieved = await getArtifact(stored.id);

    expect(retrieved).toBeDefined();
    expect(retrieved.id).toBe(stored.id);
    expect(retrieved.content).toBe('Test retrieval content');
    expect(retrieved.type).toBe('hook');
  });

  it('should return null for non-existent artifact', async () => {
    const retrieved = await getArtifact('non_existent_id');
    expect(retrieved).toBeNull();
  });

  it('should list artifacts with filters', async () => {
    // Store multiple artifacts
    await storeArtifact({
      workspaceId: TEST_WORKSPACE_ID,
      executionId: TEST_EXECUTION_ID,
      nodeId: 'node_1',
      nodeType: TEST_NODE_TYPE,
      type: 'hook',
      content: 'Hook 1',
      capability: 'GENERATE_HOOKS',
      provider: 'CLAUDE',
    });

    await storeArtifact({
      workspaceId: TEST_WORKSPACE_ID,
      executionId: TEST_EXECUTION_ID,
      nodeId: 'node_2',
      nodeType: 'GENERATE_CAPTION_VARIANTS',
      type: 'caption',
      content: 'Caption 1',
      capability: 'GENERATE_CAPTIONS',
      provider: 'OPENAI',
    });

    // List all artifacts for execution
    const allArtifacts = await listArtifacts({
      workspaceId: TEST_WORKSPACE_ID,
      executionId: TEST_EXECUTION_ID,
    });

    expect(allArtifacts.length).toBe(2);

    // List only hooks
    const hooks = await listArtifacts({
      workspaceId: TEST_WORKSPACE_ID,
      executionId: TEST_EXECUTION_ID,
      type: 'hook',
    });

    expect(hooks.length).toBe(1);
    expect(hooks[0].type).toBe('hook');
  });

  it('should soft delete artifact', async () => {
    const stored = await storeArtifact({
      workspaceId: TEST_WORKSPACE_ID,
      executionId: TEST_EXECUTION_ID,
      nodeId: TEST_NODE_ID,
      nodeType: TEST_NODE_TYPE,
      type: 'hook',
      content: 'To be deleted',
      capability: 'GENERATE_HOOKS',
      provider: 'CLAUDE',
    });

    const deleted = await deleteArtifact(stored.id);
    expect(deleted).toBe(true);

    // Artifact metadata should still exist but content cleared
    const retrieved = await getArtifact(stored.id);
    expect(retrieved).toBeDefined();
    expect(retrieved.content).toBeNull();
    expect(retrieved.metadata.deletedAt).toBeDefined();
  });

  it('should pass health check', async () => {
    const health = await healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.adapter).toBe('local');
  });

  it('should store inline content for small artifacts', async () => {
    const smallContent = 'Short hook';

    const stored = await storeArtifact({
      workspaceId: TEST_WORKSPACE_ID,
      executionId: TEST_EXECUTION_ID,
      nodeId: TEST_NODE_ID,
      nodeType: TEST_NODE_TYPE,
      type: 'hook',
      content: smallContent,
      capability: 'GENERATE_HOOKS',
      provider: 'CLAUDE',
    });

    // Should be stored inline (< 1KB)
    const retrieved = await getArtifact(stored.id);
    expect(retrieved.content).toBe(smallContent);
  });

  it('should generate correct storage key format', async () => {
    const stored = await storeArtifact({
      workspaceId: TEST_WORKSPACE_ID,
      executionId: TEST_EXECUTION_ID,
      nodeId: TEST_NODE_ID,
      nodeType: TEST_NODE_TYPE,
      type: 'hook',
      content: 'Key format test',
      capability: 'GENERATE_HOOKS',
      provider: 'CLAUDE',
    });

    // Expected format: workspace_id/execution_id/node_id/type_v{version}.json
    expect(stored.storageKey).toMatch(/^[a-f0-9-]+\/test_execution_001\/node_generate_hooks\/hook_v1\.json$/);
  });
});

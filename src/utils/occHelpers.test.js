// ============================================================
// OCC Helpers Tests
// Phase 11B Task 2: Validate optimistic concurrency control logic
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ConcurrencyError,
  updateWithOCC,
  getCurrentVersion,
  validateOCCUpdateData,
  isConcurrencyError,
} from './occHelpers.js';

// Mock prisma client
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    executionRequest: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from '../lib/prisma.js';

describe('ConcurrencyError', () => {
  it('should create error with correct message and fields', () => {
    const error = new ConcurrencyError('exec-123', 5, 7);

    expect(error.message).toBe(
      'Concurrency violation: execution exec-123 expected version 5, but current version is 7'
    );
    expect(error.name).toBe('ConcurrencyError');
    expect(error.executionId).toBe('exec-123');
    expect(error.expectedVersion).toBe(5);
    expect(error.actualVersion).toBe(7);
  });

  it('should be instance of Error', () => {
    const error = new ConcurrencyError('exec-456', 3, 4);
    expect(error instanceof Error).toBe(true);
  });
});

describe('updateWithOCC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should update successfully when version matches', async () => {
    const executionId = 'exec-123';
    const expectedVersion = 5;
    const data = { status: 'EXECUTING', activeStep: 'step-2' };

    // Mock successful updateMany (affected 1 row)
    prisma.executionRequest.updateMany.mockResolvedValue({ count: 1 });

    // Mock findUnique returning updated record
    prisma.executionRequest.findUnique.mockResolvedValue({
      id: executionId,
      version: 6, // Incremented
      status: 'EXECUTING',
      activeStep: 'step-2',
      updatedAt: new Date(),
    });

    const result = await updateWithOCC(executionId, expectedVersion, data);

    expect(prisma.executionRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: executionId,
        version: expectedVersion,
      },
      data: {
        ...data,
        version: { increment: 1 },
        updatedAt: expect.any(Date),
      },
    });

    expect(result.version).toBe(6);
    expect(result.status).toBe('EXECUTING');
  });

  it('should throw ConcurrencyError when version mismatch', async () => {
    const executionId = 'exec-456';
    const expectedVersion = 3;
    const data = { status: 'EXECUTED_SUCCESS' };

    // Mock updateMany returning 0 affected rows (version mismatch)
    prisma.executionRequest.updateMany.mockResolvedValue({ count: 0 });

    // Mock findUnique returning current state with different version
    prisma.executionRequest.findUnique.mockResolvedValue({
      id: executionId,
      version: 5, // Different from expected
    });

    await expect(
      updateWithOCC(executionId, expectedVersion, data)
    ).rejects.toThrow(ConcurrencyError);

    await expect(
      updateWithOCC(executionId, expectedVersion, data)
    ).rejects.toThrow('expected version 3, but current version is 5');
  });

  it('should throw error when execution not found', async () => {
    const executionId = 'nonexistent';
    const expectedVersion = 0;
    const data = { status: 'EXECUTING' };

    // Mock updateMany returning 0 affected rows
    prisma.executionRequest.updateMany.mockResolvedValue({ count: 0 });

    // Mock findUnique returning null (not found)
    prisma.executionRequest.findUnique.mockResolvedValue(null);

    await expect(
      updateWithOCC(executionId, expectedVersion, data)
    ).rejects.toThrow('ExecutionRequest nonexistent not found');
  });
});

describe('getCurrentVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return current version', async () => {
    const executionId = 'exec-789';

    prisma.executionRequest.findUnique.mockResolvedValue({
      version: 12,
    });

    const version = await getCurrentVersion(executionId);

    expect(version).toBe(12);
    expect(prisma.executionRequest.findUnique).toHaveBeenCalledWith({
      where: { id: executionId },
      select: { version: true },
    });
  });

  it('should throw error when execution not found', async () => {
    const executionId = 'nonexistent';

    prisma.executionRequest.findUnique.mockResolvedValue(null);

    await expect(getCurrentVersion(executionId)).rejects.toThrow(
      'ExecutionRequest nonexistent not found'
    );
  });
});

describe('validateOCCUpdateData', () => {
  it('should pass validation for valid update data', () => {
    const data = {
      status: 'EXECUTING',
      activeStep: 'step-3',
      response: { success: true },
    };

    expect(() => validateOCCUpdateData(data)).not.toThrow();
  });

  it('should reject data containing version field', () => {
    const data = {
      status: 'EXECUTING',
      version: 10, // Protected field
    };

    expect(() => validateOCCUpdateData(data)).toThrow(
      'OCC update data cannot contain protected field: version'
    );
  });

  it('should reject data containing id field', () => {
    const data = {
      status: 'EXECUTING',
      id: 'new-id', // Protected field
    };

    expect(() => validateOCCUpdateData(data)).toThrow(
      'OCC update data cannot contain protected field: id'
    );
  });

  it('should reject data containing createdAt field', () => {
    const data = {
      status: 'EXECUTING',
      createdAt: new Date(), // Protected field
    };

    expect(() => validateOCCUpdateData(data)).toThrow(
      'OCC update data cannot contain protected field: createdAt'
    );
  });
});

describe('isConcurrencyError', () => {
  it('should return true for ConcurrencyError instances', () => {
    const error = new ConcurrencyError('exec-123', 5, 7);
    expect(isConcurrencyError(error)).toBe(true);
  });

  it('should return false for generic Error instances', () => {
    const error = new Error('Some error');
    expect(isConcurrencyError(error)).toBe(false);
  });

  it('should return false for TypeError instances', () => {
    const error = new TypeError('Type error');
    expect(isConcurrencyError(error)).toBe(false);
  });

  it('should return false for non-error values', () => {
    expect(isConcurrencyError(null)).toBe(false);
    expect(isConcurrencyError(undefined)).toBe(false);
    expect(isConcurrencyError('error string')).toBe(false);
    expect(isConcurrencyError({ message: 'error object' })).toBe(false);
  });
});

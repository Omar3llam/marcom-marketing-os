// ============================================================
// Local Filesystem Adapter — dev/test artifact storage
// ============================================================
// Stores artifacts in local filesystem for development and testing.
// Production should use S3 adapter.
//
// STORAGE PATH:
//   Configured via ARTIFACT_STORAGE_PATH (default: ./artifacts)
//
// OPERATIONS:
//   - write(key, content) → void
//   - read(key) → content
//   - delete(key) → void
//   - healthCheck() → void
// ============================================================
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../../utils/logger.js';

const STORAGE_PATH = process.env.ARTIFACT_STORAGE_PATH || './artifacts';

export function createLocalAdapter() {
  // Ensure storage directory exists
  async function ensureDirectory(filePath) {
    const dir = path.dirname(filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  // Write artifact to filesystem
  async function write(key, content) {
    try {
      const filePath = path.join(STORAGE_PATH, key);
      await ensureDirectory(filePath);
      await fs.writeFile(filePath, content, 'utf8');

      logger.debug({ key, path: filePath }, '[LocalAdapter] artifact written');
    } catch (error) {
      logger.error(
        { error: error.message, key },
        '[LocalAdapter] failed to write artifact'
      );
      throw new Error(`Failed to write artifact: ${error.message}`);
    }
  }

  // Read artifact from filesystem
  async function read(key) {
    try {
      const filePath = path.join(STORAGE_PATH, key);
      const content = await fs.readFile(filePath, 'utf8');

      logger.debug({ key, path: filePath }, '[LocalAdapter] artifact read');
      return content;
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.warn({ key }, '[LocalAdapter] artifact not found');
        return null;
      }

      logger.error(
        { error: error.message, key },
        '[LocalAdapter] failed to read artifact'
      );
      throw new Error(`Failed to read artifact: ${error.message}`);
    }
  }

  // Delete artifact from filesystem
  async function deleteFile(key) {
    try {
      const filePath = path.join(STORAGE_PATH, key);
      await fs.unlink(filePath);

      logger.debug({ key, path: filePath }, '[LocalAdapter] artifact deleted');
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.warn({ key }, '[LocalAdapter] artifact not found for deletion');
        return;
      }

      logger.error(
        { error: error.message, key },
        '[LocalAdapter] failed to delete artifact'
      );
      throw new Error(`Failed to delete artifact: ${error.message}`);
    }
  }

  // Health check
  async function healthCheck() {
    try {
      // Ensure storage directory is writable
      await fs.mkdir(STORAGE_PATH, { recursive: true });

      // Write test file
      const testPath = path.join(STORAGE_PATH, '.health-check');
      await fs.writeFile(testPath, 'ok', 'utf8');

      // Read test file
      await fs.readFile(testPath, 'utf8');

      // Delete test file
      await fs.unlink(testPath);

      logger.debug('[LocalAdapter] health check passed');
    } catch (error) {
      logger.error(
        { error: error.message },
        '[LocalAdapter] health check failed'
      );
      throw new Error(`Local adapter health check failed: ${error.message}`);
    }
  }

  return {
    write,
    read,
    delete: deleteFile,
    healthCheck,
  };
}

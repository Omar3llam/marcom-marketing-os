// ============================================================
// S3 Adapter — production artifact storage
// ============================================================
// Stores artifacts in AWS S3 for production environments.
//
// CONFIGURATION:
//   ARTIFACT_STORAGE_BUCKET - S3 bucket name
//   AWS_REGION - AWS region
//   AWS_ACCESS_KEY_ID - AWS access key
//   AWS_SECRET_ACCESS_KEY - AWS secret key
//
// OPERATIONS:
//   - write(key, content) → void
//   - read(key) → content
//   - delete(key) → void
//   - healthCheck() → void
//
// NOTE: Lazy imports AWS SDK to avoid requiring it when using local adapter
// ============================================================
import { logger } from '../../../utils/logger.js';

const BUCKET = process.env.ARTIFACT_STORAGE_BUCKET;
const REGION = process.env.AWS_REGION || 'us-east-1';

if (!BUCKET) {
  logger.warn('[S3Adapter] ARTIFACT_STORAGE_BUCKET not set, adapter will not work');
}

// Lazy load AWS SDK
let S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand;
async function loadAWS() {
  if (!S3Client) {
    const aws = await import('@aws-sdk/client-s3');
    S3Client = aws.S3Client;
    PutObjectCommand = aws.PutObjectCommand;
    GetObjectCommand = aws.GetObjectCommand;
    DeleteObjectCommand = aws.DeleteObjectCommand;
    HeadBucketCommand = aws.HeadBucketCommand;
  }
}

export function createS3Adapter() {
  let client = null;

  async function getClient() {
    if (!client) {
      await loadAWS();
      client = new S3Client({
        region: REGION,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      });
    }
    return client;
  }

  // Write artifact to S3
  async function write(key, content) {
    try {
      const s3 = await getClient();
      const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: content,
        ContentType: 'application/json',
        ServerSideEncryption: 'AES256',
      });

      await s3.send(command);

      logger.debug({ key, bucket: BUCKET }, '[S3Adapter] artifact written');
    } catch (error) {
      logger.error(
        { error: error.message, key },
        '[S3Adapter] failed to write artifact'
      );
      throw new Error(`Failed to write artifact to S3: ${error.message}`);
    }
  }

  // Read artifact from S3
  async function read(key) {
    try {
      const s3 = await getClient();
      const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: key,
      });

      const response = await s3.send(command);
      const content = await streamToString(response.Body);

      logger.debug({ key, bucket: BUCKET }, '[S3Adapter] artifact read');
      return content;
    } catch (error) {
      if (error.name === 'NoSuchKey') {
        logger.warn({ key }, '[S3Adapter] artifact not found');
        return null;
      }

      logger.error(
        { error: error.message, key },
        '[S3Adapter] failed to read artifact'
      );
      throw new Error(`Failed to read artifact from S3: ${error.message}`);
    }
  }

  // Delete artifact from S3
  async function deleteFile(key) {
    try {
      const s3 = await getClient();
      const command = new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: key,
      });

      await s3.send(command);

      logger.debug({ key, bucket: BUCKET }, '[S3Adapter] artifact deleted');
    } catch (error) {
      logger.error(
        { error: error.message, key },
        '[S3Adapter] failed to delete artifact'
      );
      throw new Error(`Failed to delete artifact from S3: ${error.message}`);
    }
  }

  // Health check
  async function healthCheck() {
    try {
      const s3 = await getClient();
      const command = new HeadBucketCommand({ Bucket: BUCKET });
      await s3.send(command);

      logger.debug({ bucket: BUCKET }, '[S3Adapter] health check passed');
    } catch (error) {
      logger.error(
        { error: error.message, bucket: BUCKET },
        '[S3Adapter] health check failed'
      );
      throw new Error(`S3 adapter health check failed: ${error.message}`);
    }
  }

  return {
    write,
    read,
    delete: deleteFile,
    healthCheck,
  };
}

// Helper to convert stream to string
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

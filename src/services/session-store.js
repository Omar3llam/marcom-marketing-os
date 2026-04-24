// ============================================================
// MARCOM — Redis Session Store
// Primary: Redis (TTL 7 days)
// Fallback: in-memory Map (development only — not cluster-safe)
// Used by routes that need fast session reads outside PostgreSQL.
// ============================================================
import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

let redisClient = null;
let redisConnecting = false;

async function getRedis() {
  if (redisClient?.isReady) return redisClient;
  if (!process.env.REDIS_URL) return null;
  if (redisConnecting) return null;

  redisConnecting = true;
  try {
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', err => logger.warn({ err: err.message }, '[Redis] client error'));
    await redisClient.connect();
    logger.info('[Redis] connected');
    return redisClient;
  } catch (err) {
    logger.warn({ err: err.message }, '[Redis] connection failed — using in-memory fallback');
    redisClient = null;
    return null;
  } finally {
    redisConnecting = false;
  }
}

// Dev-only in-memory fallback (single process only)
const inMemoryStore = new Map();
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export async function createSession(userId) {
  const session = {
    id: `sess_${uuidv4()}`,
    userId,
    created_at: new Date().toISOString(),
    history: [],
    context: {},
    current_mode: 1,
    current_section: 0,
    current_service: 0,
    context_locked: false,
  };
  await saveSession(session);
  return session;
}

export async function getSession(sessionId) {
  if (!sessionId) return null;

  const redis = await getRedis();
  if (redis) {
    try {
      const raw = await redis.get(`session:${sessionId}`);
      if (raw) return JSON.parse(raw);
    } catch (err) {
      logger.warn({ err: err.message, sessionId }, '[Redis] getSession failed');
    }
  }

  return inMemoryStore.get(sessionId) || null;
}

export async function saveSession(session) {
  const serialized = JSON.stringify(session);
  const redis = await getRedis();

  if (redis) {
    try {
      await redis.setEx(`session:${session.id}`, SESSION_TTL_SECONDS, serialized);
      return;
    } catch (err) {
      logger.warn({ err: err.message, sessionId: session.id }, '[Redis] saveSession failed — falling back to memory');
    }
  }

  inMemoryStore.set(session.id, session);
}

export async function deleteSession(sessionId) {
  const redis = await getRedis();
  if (redis) {
    try { await redis.del(`session:${sessionId}`); } catch {}
  }
  inMemoryStore.delete(sessionId);
}

// ============================================================
// MARCOM — PostgreSQL Pool
// Single shared `postgres` instance for the entire process.
//
// Dev Mode Graceful Degradation:
// - In development, if DATABASE_URL is missing or connection
//   fails, return null instead of crashing the app.
// - Routes that need DB should check `if (!sql)` and skip writes.
// ============================================================
import postgres from 'postgres';

let _sql = null;
let _connectionFailed = false;
const isDev = process.env.NODE_ENV === 'development';

function shouldUseSsl(databaseUrl) {
  // Neon requires TLS, including in development.
  if (databaseUrl.includes('.neon.tech')) {
    return true;
  }

  // Respect explicit sslmode in connection string.
  if (/sslmode=require/i.test(databaseUrl)) {
    return true;
  }

  if (/sslmode=disable/i.test(databaseUrl)) {
    return false;
  }

  return process.env.NODE_ENV === 'production';
}

export function getDb() {
  if (_connectionFailed) {
    return null; // Already tried and failed
  }

  if (!_sql) {
    if (!process.env.DATABASE_URL) {
      if (isDev) {
        console.warn('[DEV MODE] DATABASE_URL not set. Running in stateless AI mode (DB writes bypassed).');
        _connectionFailed = true;
        return null;
      }
      throw new Error('DATABASE_URL is required in production');
    }

    try {
      const useSsl = shouldUseSsl(process.env.DATABASE_URL);
      _sql = postgres(process.env.DATABASE_URL, {
        max:         10,
        idle_timeout: 20,
        connect_timeout: 10,
        // R11 (E4) — verify the server's certificate in production.
        //
        // This was `rejectUnauthorized: false` unconditionally: the connection
        // was encrypted but the server was never authenticated, so anything
        // able to answer for the host could present its own certificate and be
        // trusted. This is the pool that carries marcom_credentials — the
        // encrypted OAuth tokens for customers' ad accounts — over the public
        // internet to Neon. Prisma's own connection already verifies; only this
        // raw pool did not.
        //
        // Kept permissive outside production, where a local Postgres commonly
        // has a self-signed certificate and failing closed would just make
        // people set the flag back.
        ssl: useSsl
          ? { rejectUnauthorized: process.env.NODE_ENV === 'production' }
          : false,
        onnotice: () => {},   // suppress NOTICE messages
      });
    } catch (error) {
      if (isDev) {
        console.warn('[DEV MODE] PostgreSQL connection failed. Running in stateless AI mode (DB writes bypassed).');
        console.warn(`[DEV MODE] Error: ${error.message}`);
        _connectionFailed = true;
        return null;
      }
      throw error;
    }
  }
  return _sql;
}

export async function closeDb() {
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = null;
  }
}

export function isDbAvailable() {
  return _sql !== null && !_connectionFailed;
}

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
      _sql = postgres(process.env.DATABASE_URL, {
        max:         10,
        idle_timeout: 20,
        connect_timeout: 10,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
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

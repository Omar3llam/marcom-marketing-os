// ============================================================
// MARCOM — PostgreSQL Pool
// Single shared `postgres` instance for the entire process.
// ============================================================
import postgres from 'postgres';

let _sql = null;

export function getDb() {
  if (!_sql) {
    _sql = postgres(process.env.DATABASE_URL, {
      max:         10,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
      onnotice: () => {},   // suppress NOTICE messages
    });
  }
  return _sql;
}

export async function closeDb() {
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = null;
  }
}

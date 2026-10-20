// 03B-3C — source-only boot boundary, no real DB/provider or runtime import.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ sql: null, statements: [] }));
vi.mock('../utils/db.js', () => ({ getDb: () => state.sql }));
vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
import { ensureCredentialSchema } from '../models/credential.js';

beforeEach(() => {
  state.statements = [];
  state.sql = async (strings, ...params) => {
    const text = strings.join('?');
    state.statements.push({ text, params });
    return [];
  };
});

describe('03B-3C credential schema ensure: no automatic customer-data repair', () => {
  it('executes only eight literal native DDL statements, without any census, row write or account selection', async () => {
    await ensureCredentialSchema();
    expect(state.statements).toHaveLength(8);
    for (const { text, params } of state.statements) {
      expect(params).toEqual([]);
      expect(text).toMatch(/^\s*(?:CREATE\s+(?:TABLE|INDEX)|ALTER\s+TABLE)\b/i);
      expect(text).not.toMatch(/\b(?:SELECT|UPDATE|INSERT|DELETE|TRUNCATE|DO)\b/i);
    }
    expect(state.statements.filter(({ text }) => /marcom_credentials/.test(text))).toHaveLength(8);
  });

  it('stops after a schema statement fails, without executing customer-data reconciliation', async () => {
    let calls = 0;
    state.sql = async (strings, ...params) => {
      const text = strings.join('?');
      state.statements.push({ text, params });
      if (++calls === 3) throw Object.assign(new Error('synthetic ddl refusal'), { code: '42501' });
      return [];
    };
    await ensureCredentialSchema(); // existing failure semantics are unchanged and remain non-admission-safe.
    expect(state.statements).toHaveLength(3);
    for (const { text, params } of state.statements) {
      expect(params).toEqual([]);
      expect(text).toMatch(/^\s*(?:CREATE\s+(?:TABLE|INDEX)|ALTER\s+TABLE)\b/i);
    }
  });
});

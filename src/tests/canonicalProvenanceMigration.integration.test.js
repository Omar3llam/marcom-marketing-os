import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { dbAvailable } from '../tests/dbProbe.js';
import { PrismaClient } from '@prisma/client';
import { verifyCanonicalProvenanceCatalog } from '../../scripts/verify-canonical-provenance-catalog.js';
import { scrubUrl } from './dbIsolation.js';

const DB_OK = process.env.REQUIRE_DB === '1' ? await dbAvailable() : false;
const migrationName = '20261015000000_canonical_provenance_v1';
const cli = resolve('node_modules/prisma/build/index.js');
function prisma(args, url, cwd) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url, CHECKPOINT_DISABLE: '1' } });
  if (r.status !== 0) throw new Error(scrubUrl(`prisma ${args[0]} ${args[1]} failed (${r.status}): ${r.stdout}\n${r.stderr}`));
  return r.stdout;
}

describe.skipIf(!DB_OK)('02B-1 actual migration replay / restricted migrator', () => {
  it('upgrades populated baseline, recovers actual failed DDL, repeats, validates and preserves preexisting drift', async () => {
    const u = new URL(process.env.DATABASE_URL); u.pathname = '/postgres';
    const admin = postgres(u.toString(), { max: 1, onnotice: () => {} });
    const token = randomUUID().replaceAll('-', ''), role = `cp_migrator_${token}`, name = `cp_schema_${token}`;
    const password = randomBytes(24).toString('hex');
    const temp = mkdtempSync(join(tmpdir(), 'lumi-canonical-schema-'));
    const root = resolve('prisma');
    // Do not mutate/delete any tracked application migration.
    cpSync(root, join(temp, 'prisma'), { recursive: true, filter: (p) => !p.includes(migrationName) && !p.endsWith('.catalog.json') });
    // CI checks out shallow/sparse. Derive ONLY the additive model delta and
    // verify remaining model text against pinned9b48 bytes without Git history.
    const current=readFileSync(join(root,'schema.prisma'),'utf8').replaceAll('\r\n','\n');
    const baseline=current.replace(/^model Canonical(?:Refresh|LevelAttempt|WriteAttempt|Observation) \{[\s\S]*?^\}\n/gm,'')
      .replace(/^[ \t]*canonicalRefreshes[ \t]+CanonicalRefresh\[\].*\n/m,'');
    const normalized=baseline.split('\n').map(l=>l.replace(/\/\/.*$/,'').trim()).filter(Boolean).join('\n');
    expect(createHash('sha256').update(normalized).digest('hex')).toBe('11daa74e4af9420f78d6d8ec85c2593bca3d050ef7886e66065fa821d55c23b3');
    writeFileSync(join(temp,'prisma','schema.prisma'),baseline);
    let db;
    try {
      await admin.unsafe(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER CREATEDB CREATEROLE`);
      // Explicit lab DBA bootstrap; never assume production has these powers.
      await admin.unsafe(`GRANT lumi_canonical_owner TO "${role}" WITH ADMIN OPTION`);
      await admin.unsafe(`CREATE DATABASE "${name}" OWNER "${role}"`);
      u.pathname = `/${name}`; u.username = role; u.password = password;
      const url = u.toString(); db = postgres(url, { max: 1, onnotice: () => {} });
      const first = prisma(['migrate','deploy','--schema',join(temp,'prisma','schema.prisma')],url,temp);
      expect(first).toContain('All migrations have been successfully applied.');
      const [missing] = await db`SELECT to_regclass('public.canonical_refreshes') AS r`; expect(missing.r).toBeNull();
      const ws=randomUUID(),entity=randomUUID(),id=randomUUID();
      await db`INSERT INTO workspaces(id,name,"adChannels") VALUES(${ws},'populated pre-02B-1 baseline','{}')`;
      await db`INSERT INTO metric_snapshots(id,"workspaceId","entityId","entityLevel",date,source,granularity,"measurementWindow","spendMinor",currency)
        VALUES(${id},${ws},${entity},'CAMPAIGN','2026-10-15 09:00','META','DAILY','CUMULATIVE_30D',987,'USD')`;
      const [before] = await db`SELECT to_jsonb(m) AS row FROM metric_snapshots m WHERE id=${id}`;
      const oldDiff=prisma(['migrate','diff','--from-url',url,'--to-schema-datamodel',join(temp,'prisma','schema.prisma'),'--script'],url,temp);
      // Adversarial legacy defaults must not leak ALTER/TRUNCATE/EXECUTE or
      // private-schema CREATE into the new runtime capability.
      await db`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO lumi_canonical_app`;
      await db`ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO lumi_canonical_app`;
      await db`ALTER DEFAULT PRIVILEGES GRANT CREATE,USAGE ON SCHEMAS TO lumi_canonical_app`;
      const ddl=readFileSync(join(root,'migrations',migrationName,'migration.sql'),'utf8');
      await expect(db.unsafe(ddl.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;'))).rejects.toMatchObject({code:'22012'});
      await db`ROLLBACK`;
      const [clean]=await db`SELECT to_regclass('public.canonical_refreshes') AS r,to_regprocedure('canonical_provenance.canonical_guard()') AS f`;
      expect(clean).toEqual({r:null,f:null});
      expect(prisma(['migrate','deploy','--schema',join(root,'schema.prisma')],url,temp)).toContain(migrationName);
      expect(prisma(['migrate','deploy','--schema',join(root,'schema.prisma')],url,temp)).toContain('No pending migrations to apply.');
      expect(prisma(['validate','--schema',join(root,'schema.prisma')],url,temp)).toContain('is valid');
      const newDiff=prisma(['migrate','diff','--from-url',url,'--to-schema-datamodel',join(root,'schema.prisma'),'--script'],url,temp);
      expect(newDiff).toBe(oldDiff); // Known legacy drift is preserved, not repaired here.
      const [after] = await db`SELECT to_jsonb(m) AS row FROM metric_snapshots m WHERE id=${id}`; expect(after).toEqual(before);
      const audit=await verifyCanonicalProvenanceCatalog(db); expect(audit.status).toBe('PASS');
      const client=new PrismaClient({datasources:{db:{url}}});
      try{const [connection]=await client.$queryRaw`SELECT current_database() AS name`;expect(connection.name).toBe(name);
        for(const model of ['canonicalRefresh','canonicalLevelAttempt','canonicalWriteAttempt','canonicalObservation'])expect(await client[model].findMany()).toEqual([]);
      }finally{await client.$disconnect();}
      const [count]=await db`SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`; expect(count.n).toBe(76);
      const [restricted]=await db`SELECT rolsuper,rolcanlogin FROM pg_roles WHERE rolname=current_user`;expect(restricted).toEqual({rolsuper:false,rolcanlogin:true});
      console.info('02B-1 replay:75→76 migrations; injected22012 rolled back actual DDL; repeat deploy/validate/catalog PASS; existing snapshot and legacy diff unchanged; migrator NOSUPERUSER, with explicit lab DBA role grant.');
    } finally {
      if(db)await db.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.unsafe(`DROP ROLE IF EXISTS "${role}"`);
      await admin.end();
      // Small scratch schema/log files retained in OS temp, no running DB.
    }
  }, 60000);
});

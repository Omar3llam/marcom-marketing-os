// ============================================================
// globalSetup — provision one database per worker, for full verification only
// ============================================================
// Runs ONCE in the main vitest process, before any worker starts.
//
//     TEST_DATABASE_URL  →  <root>_tmpl   migrated once (prisma migrate deploy)
//                        →  <root>_w1..N  CREATE DATABASE … TEMPLATE  (~360ms each)
//
// Teardown drops every database it created, including on failure.
//
// FAIL CLOSED (§21). If provisioning cannot complete, this throws and the run
// ends. There is no path here that falls back to the ambient database, and none
// that lets DB suites skip quietly — B5-01G already made a skipped DB suite a
// failure under REQUIRE_DB, and this must not reopen that door from a different
// direction.
// ============================================================
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';
import {
  MAX_WORKERS, IsolationSetupError, resolveIsolationRoot,
  adminUrl, databaseName, templateName, workerName, urlForDatabase, scrubUrl,
  sealTemplate, unsealTemplate, withSourceInUseRetry, isSourceInUseError,
  TEMPLATE_COPY_ATTEMPTS,
} from './dbIsolation.js';

const isFullVerification = () => process.env.REQUIRE_DB === '1';

/**
 * Serial on purpose: CREATE DATABASE … TEMPLATE refuses while the source has
 * other sessions. Spawning `migrate deploy` as a child makes OUR session go
 * away; sealing the template afterwards makes everyone else's stay away.
 */
async function provision(root) {
  const sql = postgres(adminUrl(root), { max: 1, idle_timeout: 5, onnotice: () => {} });
  const created = [];
  try {
    const rootName = databaseName(root);
    const tmpl = templateName(rootName);

    await sql.unsafe(`DROP DATABASE IF EXISTS "${tmpl}" WITH (FORCE)`);
    await sql.unsafe(`CREATE DATABASE "${tmpl}"`);
    created.push(tmpl);

    // Real migrations, not `db push`: the schema under test must be the schema
    // production gets, including constraint and index semantics that a
    // schema-diff push can render differently.
    const tmplUrl = urlForDatabase(root, tmpl);
    const migrate = spawnSync(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
      // B5-01P″′ — CHECKPOINT_DISABLE: prisma phones checkpoint.prisma.io for
      // version telemetry. networkGuard sets this for the test WORKERS, but
      // globalSetup runs in the main vitest process and spawns this child with
      // its own env, so the provisioning step was the last thing in `test:full`
      // still reaching the public internet.
      {
        env: {
          ...process.env, DATABASE_URL: tmplUrl, DIRECT_URL: tmplUrl, CHECKPOINT_DISABLE: '1',
        },
        encoding: 'utf8',
      },
    );
    if (migrate.status !== 0) {
      throw new IsolationSetupError(
        `prisma migrate deploy failed against the template database.\n${scrubUrl(migrate.stdout ?? '')}\n${scrubUrl(migrate.stderr ?? '')}`,
      );
    }

    // The template is migrated and nothing needs to connect to it again, so
    // shut it. A CONNECTABLE database can be re-occupied between copies, and on
    // Neon it reliably is — see sealTemplate in dbIsolation.js for the measured
    // failure this removes. Sealing after `migrate deploy` (which needs to
    // connect) and before the first copy is the only window that works.
    await sealTemplate((statement) => sql.unsafe(statement), tmpl);

    for (let id = 1; id <= MAX_WORKERS; id++) {
      const name = workerName(rootName, id);
      await sql.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      try {
        // Sealed, this succeeds on the first attempt. The retry is defence in
        // depth for servers that hold the source some other way, and it is
        // bounded — it cannot turn a broken provisioner into a slow one.
        await withSourceInUseRetry(() => sql.unsafe(`CREATE DATABASE "${name}" TEMPLATE "${tmpl}"`));
      } catch (err) {
        if (!isSourceInUseError(err)) throw err;
        throw new IsolationSetupError(
          `worker database "${name}" could not be copied: the template "${tmpl}" stayed occupied\n`
          + `  through ${TEMPLATE_COPY_ATTEMPTS} attempts. It was already sealed against new connections, so\n`
          + '  something holds it that ALLOW_CONNECTIONS=false does not exclude — a replication slot,\n'
          + '  or a backend owned by a role this connection may not terminate.',
        );
      }
      created.push(name);
    }
    // Copying is done, so the seal has served its purpose. Reopen it:
    // migrationContract.test.js P1 connects to the template to prove a stale
    // one was destroyed, and a permanently shut template would fail that for
    // a reason that has nothing to do with what it is testing.
    await unsealTemplate((statement) => sql.unsafe(statement), tmpl);
    return { rootName, created };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

async function drop(root, names) {
  const sql = postgres(adminUrl(root), { max: 1, idle_timeout: 5, onnotice: () => {} });
  try {
    for (const n of names) await sql.unsafe(`DROP DATABASE IF EXISTS "${n}" WITH (FORCE)`).catch(() => {});
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

export default async function setup() {
  if (!isFullVerification()) return () => {};

  const root = resolveIsolationRoot(process.env);   // throws IsolationSetupError
  let state;
  try {
    state = await provision(root);
  } catch (err) {
    if (err instanceof IsolationSetupError) throw err;
    throw new IsolationSetupError(`could not provision isolated databases: ${scrubUrl(err.message)}`);
  }

  // Workers read this to find their own database. Names only — never a URL.
  process.env.LUMI_TEST_DB_ROOT = state.rootName;
  console.log(
    `▶ isolated verification: ${MAX_WORKERS} worker databases provisioned from `
    + `${state.rootName}_tmpl (migrated)`,
  );

  return async () => { await drop(root, state.created); };
}

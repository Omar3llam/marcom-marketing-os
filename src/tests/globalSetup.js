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
} from './dbIsolation.js';

const isFullVerification = () => process.env.REQUIRE_DB === '1';

/** Serial on purpose: CREATE DATABASE … TEMPLATE refuses while the source has other sessions. */
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

    for (let id = 1; id <= MAX_WORKERS; id++) {
      const name = workerName(rootName, id);
      await sql.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await sql.unsafe(`CREATE DATABASE "${name}" TEMPLATE "${tmpl}"`);
      created.push(name);
    }
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

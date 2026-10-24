# Fresh PostgreSQL17 target provisioning

Status: code-only candidate for independent review. **No hosted provisioning,
database creation, deployment or runtime activation is authorized by this PR.**
Backend Gates B/C remain BLOCKED. Historical Neon resources remain untouched.

The owner ruled that historical records are disposable development/test data.
This removes historical recovery from the replacement path; it does not permit
deleting an existing resource or relaxing authentication, tenant or product truth.

## Operator contract and dependencies

`node scripts/fresh-target/cli.js` is explicitly invoked. It has no package,
build, server, worker, health or startup caller. Importing the modules does not
connect, provision or read ambient database configuration. This is an operator
schema tool, not an admission issuer. Every result carries
`scope=FRESH_TARGET_PROVISIONING_ONLY` and `runtimeAdmission=NOT_WIRED`.

The approved subject is master `a216e81ef35e1bcca08a8a54a6ddab1aa5179d3b`.
The original76 migrations, original legacy manifests and their source files are
unchanged. The new pinned `profile.v1.json` describes the complete combined
native schema and privilege profile. Its SHA256 is compiled in `contract.js`.
No operator source-root, manifest, connection-factory or schema override exists.

Source loading verifies the sealed v2 source inventory, all76 migration names
and **exact immutable Git-byte checksums**, and all26 existing DDL statements.
CRLF migration artifacts are refused before connection. Use an LF Git artifact
for both migration and runtime; never normalize stored receipts to accommodate
another checkout. The existing execution receipt gate is unchanged.

The provisioner materializes verified in-memory migration bytes and a schema in
an OS temporary directory. It invokes the existing Prisma5.22 CLI through the
current Node executable with a clean child environment, no dotenv, telemetry or
ambient provider settings. There is one migration deployment attempt. On failure
the target is partial/unqualified: preserve it and its receipts for review.
There is no resolve, rollback-history rewrite, automatic retry or repair mode.

The initial exact file allowlist was frozen before editing. The owner separately
approved the one-line hosted test image change from postgres:15 to postgres:17.
That extension affects test infrastructure only. Existing assertions, security
checks and timeout limits were not weakened.

## Preconditions supplied by a separately approved administrator

The provisioner creates no database or login, grants no role membership and
does not obtain credentials. Before an actual operation, an administrator must
independently attest a **new empty PG17 target** and bootstrap exactly:

| Role | LOGIN | Inheritance / allowed capabilities |
|---|---|---|
| `lumi_backend_owner` | No | Database owner; owns noncanonical tables/types, legacy function and pgcrypto extension |
| `lumi_backend_migrator` | Yes | Member of backend owner and canonical owner; no ADMIN OPTION |
| `lumi_backend_runtime` | Yes | Member only of canonical app; no owner, retention, role administration or DDL |
| `lumi_backend_auditor` | Yes | No membership; catalogs and migration receipts only |
| `lumi_canonical_owner` | No | Capability defined by unchanged migration76 |
| `lumi_canonical_app` | No | Capability defined by unchanged migration76 |
| `lumi_canonical_retention` | No | Capability defined by unchanged migration76; runtime is not enrolled |

All seven roles are INHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE,
NOREPLICATION, NOBYPASSRLS, with no role settings or default grants.
The exact three memberships have INHERIT/SET, no ADMIN OPTION; all additional
incoming/outgoing memberships fail. An independent platform administrator
remains a trusted external authority, never an application capability.

The database is owned by `lumi_backend_owner`. Revoke PUBLIC database privileges;
grant only CONNECT to the migrator. Keep the stock PG17 public schema owner
`pg_database_owner` and initial PUBLIC USAGE / owner CREATE+USAGE ACL. No user
schema/object/extension beyond the standard plpgsql may preexist.
The database encoding/locale must match the sealed legacy fixture: UTF8,
LC_COLLATE=C, LC_CTYPE=C, libc provider. Other locale/provider combinations are
refused, not silently treated as equivalent through the name `default`.
The migrator also needs EXECUTE on `pg_catalog.pg_control_system()` for physical identity
verification. No application login is permitted to connect until completion.

Bootstrap role/database grants are prerequisites, **not SQL executed by this
tool**. They require separate approval on any hosted system. A provider that
cannot satisfy this exact profile is unsupported until independently reviewed;
there is no privileged fallback. The profile is qualified on stock PG17.11;
Neon/Supabase compatibility is NOT_TESTED.

The platform owner of trusted pgcrypto C functions must be independently known
and included in the target approval. Stock PostgreSQL assigns those functions
to its bootstrap superuser even when a restricted database owner installs the
trusted extension. Qualification requires that approved role to exist and be a
superuser. Only its literal name is bound to `<platform_owner>` in the profile;
other owners/grants and exact function definition hashes remain checked. The
known pgcrypto C functions retain their exact standard PUBLIC EXECUTE grants.
They are not SECURITY DEFINER and confer no table/schema privileges. The legacy
trigger function and canonical functions have no PUBLIC EXECUTE. This is not
permission to grant a platform/admin role to runtime.

## Approval input and invocation

An approval file is a regular JSON file of at most8192 bytes, held in a trusted
operator-controlled path. The approval/digest must be reviewed through an
independent owner channel. This is a local operator authorization contract, not
a cryptographic signature or a token proving that product-owner approval exists.
Someone who controls both the program and the trusted approval channel can run
SQL independently; this tool does not defend against a malicious DBA.

Required object shape (every field is mandatory; no extra keys):

```json
{
  "version": 1,
  "operation": "PROVISION_EMPTY_PG17",
  "expiresAt": 0,
  "artifactSha256": "64 lowercase hexadecimal characters from the reviewed artifact",
  "target": {
    "host": "approved direct hostname",
    "port": 5432,
    "database": "lumi_fresh_approved_unique_name",
    "login": "lumi_backend_migrator",
    "serverAddress": "independently observed server IP",
    "serverPort": 5432,
    "systemIdentifier": "independently verified physical system ID",
    "databaseOid": 0,
    "platformOwner": "independently verified platform superuser name"
  }
}
```

This is explanatory, deliberately nonexecutable placeholder data. Obtain actual
identity, OID and physical system ID independently before approving the target.
Expiry must be in the future and no more than24h away at invocation. Approval
binds the source/profile artifact hash, endpoint and authenticated migrator, not
an ambient URL. The CLI accepts only these dedicated environment variables:

| Variable | Contract |
|---|---|
| `FRESH_TARGET_APPROVAL_FILE` | Explicit trusted approval JSON path |
| `FRESH_TARGET_APPROVAL_SHA256` | SHA256 of `JSON.stringify(parsedApproval)`; independent expected digest |
| `FRESH_TARGET_URL` | Explicit `postgresql://` URL; exact approved user/host/port/database, no query or fragment |
| `FRESH_TARGET_CA_FILE` | Required trusted CA PEM for any host except literal127.0.0.1 |
| `FRESH_TARGET_ACTION` | `provision` (default) or `inspect` (read-only) |

To identify the review artifact, call `loadFreshContract()` and record its
`artifactSha256`. It binds the four implementation modules, pinned profile, frozen source inventory and all26
DDL statement hashes. Do not obtain it by accepting an operator manifest.

Non-loopback postgres.js connections require CA and `rejectUnauthorized:true`.
The Prisma child uses `sslmode=require`, `sslaccept=strict`, and the same CA.
There is no plaintext fallback or operator SSL-mode override. These are
[Prisma's connector parameters](https://docs.prisma.io/docs/orm/v6/overview/databases/postgresql).
Unit tests verify strict configuration/refusal; real hosted TLS qualification
remains NOT_TESTED. Literal loopback is the disposable local-lab exception.

## Execution and refusal

1. Verify fixed sources/profile, approval shape/digest/artifact/expiry and URL
   before database I/O. Refuse proxies/accessors and unknown fields.
2. Open one authenticated session. Read-only repeatable-read preflight verifies
   PG17, physical system ID, database/OID, session identity, address/port,
   database owner, platform role and exact bootstrap permissions. Refuse other
   target sessions, unexpected default privileges, schemas, tables, types,
   domains, functions, triggers, extensions or other namespace objects.
3. Acquire a cooperative operator advisory lock and repeat preflight before DDL.
   Database CONNECT is fenced by the bootstrap profile. This cannot exclude a
   malicious superuser or prevent every DBA race; maintain administrative
   exclusivity for the operation. No runtime is activated.
4. Apply the76 verified migration artifacts with Prisma, then the26 existing
   legacy DDL statements as the NOLOGIN owner. Running legacy DDL first produces
   Prisma P3005 on an unbaselined target; that RED evidence is retained.
5. Reconcile the explicit combined permission profile. Assign noncanonical
   table/type ownership to backend owner, grant runtime DML on application
   tables and only SELECT on migration receipts, grant auditor only receipt
   SELECT, and preserve migration76's canonical app column capabilities.
   Apply its existing narrow vault column grant after the vault exists.
   Revoke PUBLIC application schema/type/legacy-function access. Runtime has
   no TEMP/CREATE database right, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN,
   GRANT OPTION or owner/retention membership. The runtime capability is a
   shared backend role; per-request tenant authority remains in the application.
6. Read-only repeatable-read qualification compares the complete pinned catalog:
   tables/columns/defaults/types, constraints/composite FKs, indexes, triggers,
   function hashes/security/search paths, extensions, all object/column/default
   ACLs, roles/memberships/settings, policies and namespace inventory. Explicit
   system-function grants to application roles and effective sensitive file,
   large-object and administration function capabilities are also pinned;
   foreign default grants or a direct system-function escalation fail preflight.
   Verify
   exactly76 clean, unique, ordered, finished steps=1 receipts with exact source
   checksums. Verify every application table is empty; create no user/workspace,
   account, token, snapshot or decision. Recheck approval expiry.

Success returns PROVISIONED_MATCH/exit0; every failure returns REFUSED/exit1 with
fixed sanitized reason/phase and, for native drift, category names. No URL,
password, customer row or provider credential is returned. The child output is
not printed. No provider request, backfill, account selection or onboarding
state is invented. A failed/ambiguous result never authorizes activation.

Repeated `provision` refuses the nonempty/final-ACL target before DDL and leaves
all receipts intact. `inspect` rechecks the same approved identity, pinned
schema/permission profile, receipts and application emptiness read-only; it
returns OBSERVED_MATCH or REFUSED. It does not repair drift or supply ongoing
runtime admission after real customer records exist.

## Evidence, review and rollback

The local fixture uses independent physical PG17 targets, not the backend's
shared worker database. Native binaries are explicitly supplied via
`FRESH_TARGET_TEST_PG_BIN`; Linux CI uses its local Docker Unix socket and cached
postgres:17 image with `--pull=never`, publishes only a loopback port and never
uses a remote daemon. The test-owned cluster is stopped and its PID/container
absence verified. Windows physical files are retained for evidence. Local
initdb `--no-sync` only avoids flushing the empty initial test cluster; normal
server fsync/transaction behavior remains enabled. It is not a recovery drill.

Required RED/GREEN cases cover missing legacy schema, unapproved/wrong physical
identity, wrong role, extra grants/membership/default privileges, altered source
or profile, conflicting table/domain, complete provisioning, strict native
qualification, repeat refusal/history preservation, runtime negatives, tenant
parent integrity, catalog/grant drift and receipt tampering. Existing auth and
workspace regressions must run unchanged in full verification; a shared runtime
SQL role is not a per-tenant RLS identity.

The independent review must inspect the pinned profile and its full ACL matrix,
especially runtime table-level DML, pgcrypto platform binding, canonical owner
vault grants, source byte identity, approval provenance, concurrency fence and
failure/partial-target behavior. New profile expected-state generation is not
an operator command; no production observation may silently bless drift.

Rollback before deployment is withdrawal of this unused operator code. After an
authorized future failed provisioning, quarantine the new partial target and
preserve receipts; no automatic deletion, resolve, repair or retry. Any cleanup
or replacement is separately authorized. API/Worker admission, future backup
qualification, provider/runtime-role qualification, cache freshness, canonical
capture/eligibility and service cutover remain separate blockers.

Final immutable head, actual test counts, CI step results and raw-evidence hashes
are recorded in the Draft PR and accompanying evidence package. Hosted jobs
that execute zero steps are NOT_TESTED. Local or CI success never closes Gates
B/C or authorizes hosted provisioning, a merge or deployment.

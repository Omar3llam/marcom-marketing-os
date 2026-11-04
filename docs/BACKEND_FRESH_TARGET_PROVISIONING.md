# Fresh PostgreSQL17 target provisioning

Status: code-only candidate for independent review. **No hosted provisioning,
database creation, deployment or runtime activation is authorized by this PR.**
Backend Gates B/C remain BLOCKED. Historical Neon resources remain untouched.

## Exclusive writer controller candidate — synthetic Linux only

This bounded candidate starts from master
`e03d6c5174377967b7eaa7feec1799fbfc79c939`. Earlier sections describe historical
protocol and containment evidence; those experiments do not authorize this
writer. Hosted compatibility, runtime admission and Gates B/C remain unqualified.

A policy JSON, CA, credential hash or earlier SQL identity observation cannot
authorize mutation on its own. Even literal-loopback mutation now refuses before
constructing the database client unless the operator is already inside a
controller-owned Linux cell with a current, root-owned, read-only kernel lease.
There is no Windows or policy-only fallback. Unsealed read-only inspection
retains its previous observer contract and supplies no mutation authority.

## F-01 trust bootstrap — mandatory before privileged application evaluation

Direct Root execution of a controller in a writable checkout is retired. A
controller self-check runs too late to authenticate that entrypoint.

The Root operator must obtain TWO independent external review pins: the exact
bootstrap literal below and an immutable source-closure identity manifest. Never
calculate these pins by importing the candidate or accepting values from its
environment. Hashing unchecked working files, copying them, or chown/chmod alone
does not establish approval. Without an independently approved identity: STOP.

The manifest has version 1, scope `F01_REVIEWED_SOURCE_CLOSURE`, a `files`
map (relative path to exact `sha256`, `bytes`, `executable`), and `runtime`
(exact Node executable `sha256`, `bytes`). Review the complete root closure:
controller, contract, package scope metadata, all postgres/src modules, and the
Node executable; all contract data and unprivileged writer files are included
as well. Unlisted inputs are never copied. No symlink is copied or traversed.
Existing canonical Root-owned OS binaries/libraries are the trusted base.

Invoke the EXACT externally reviewed literal with existing trusted OS
`/usr/bin/python3 -I -S -c '<literal>' --launch <source> <node> <identity>
<expected-identity-sha256> <unique-label>`. The literal itself must be passed
from the independently pinned review artifact, not imported from the checkout.
Do not run a mutable helper to select the Root command. The Root command receipt
must preserve the literal's hash and the external expected identity digest.

The `--verify-intake` mode evaluates no application code and starts no process
or connection. It is available for unprivileged negative tests; it supplies no
execution authorization. Only `--launch` can seal and execute, and it requires
Root. All post-verification code, runtime and source paths live below the
task-owned `/var/lib/lumi-exclusive-613` tree, with Root-owned non-writable
ancestors. This deliberately replaces the earlier home-based retained root,
whose user-owned ancestor permitted pathname replacement. Historical retained
directories remain untouched. Private storage qualification and independent
post-lifecycle retention checks remain mandatory.

<!-- F01_BOOTSTRAP_BEGIN -->
```python
# F01 trusted OS bootstrap. Execute this exact reviewed literal with python3 -I -S.
# Its digest and the manifest digest must come from the independent external review.
import os, sys, stat, hashlib, json, tempfile
BASE = "/var/lib/lumi-exclusive-613"
def refuse(): raise RuntimeError("PRIVILEGED_SOURCE_UNQUALIFIED")
def digest(b): return hashlib.sha256(b).hexdigest()
def stable(s): return (s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode,s.st_uid,s.st_gid)
def checked_open(path, directory=False):
    if not path.startswith("/") or os.path.normpath(path)!=path: refuse()
    fd=os.open("/",os.O_RDONLY|os.O_DIRECTORY)
    try:
        for i, part in enumerate(path.split("/")[1:]):
            nxt=os.open(part,os.O_RDONLY|os.O_NOFOLLOW|(os.O_DIRECTORY if directory or i<len(path.split("/"))-2 else 0),dir_fd=fd)
            os.close(fd);fd=nxt
            s=os.fstat(fd)
            if s.st_uid not in (0,os.getuid() or 1000) or s.st_mode&0o022: refuse()
        s=os.fstat(fd)
        if directory and not stat.S_ISDIR(s.st_mode): refuse()
        if not directory and (not stat.S_ISREG(s.st_mode) or s.st_nlink!=1): refuse()
        return fd
    except BaseException:
        os.close(fd);raise
def read_bounded(fd, expected_size):
    remaining=expected_size;chunks=[]
    while remaining:
        b=os.read(fd,min(1048576,remaining))
        if not b: refuse()
        chunks.append(b);remaining-=len(b)
    if os.read(fd,1): refuse()
    return b"".join(chunks)
def read_exact(path, expected):
    fd=checked_open(path)
    try:
        before=os.fstat(fd)
        if before.st_size!=expected["bytes"]: refuse()
        data=read_bounded(fd,before.st_size)
        if stable(before)!=stable(os.fstat(fd)) or digest(data)!=expected["sha256"]: refuse()
        current=os.stat(path,follow_symlinks=False)
        if stable(current)!=stable(before): refuse()
        return data,stable(before)
    finally: os.close(fd)
def root_path(path):
    p=path
    while True:
        s=os.lstat(p)
        if s.st_uid!=0 or s.st_mode&0o022 or stat.S_ISLNK(s.st_mode): refuse()
        if p=="/": break
        p=os.path.dirname(p)
def main():
    if len(sys.argv)!=7: refuse()
    mode,source,runtime,identity,pin,label=sys.argv[1:]
    if mode not in ("--verify-intake","--launch") or len(pin)!=64 or any(c not in "0123456789abcdef" for c in pin): refuse()
    if not label.isascii() or not label.isalnum() or len(label)>40: refuse()
    # The expected identity is an operator-supplied external pin, never a value
    # calculated by importing candidate code or supplied through its environment.
    identity_fd=checked_open(identity)
    try:
        identity_before=os.fstat(identity_fd)
        if not 0<identity_before.st_size<=262144: refuse()
        raw=read_bounded(identity_fd,identity_before.st_size)
        if stable(identity_before)!=stable(os.fstat(identity_fd)) or stable(os.stat(identity,follow_symlinks=False))!=stable(identity_before): refuse()
    finally: os.close(identity_fd)
    if digest(raw)!=pin: refuse()
    manifest=json.loads(raw)
    if set(manifest)!={"version","scope","files","runtime"} or manifest["version"]!=1 or manifest["scope"]!="F01_REVIEWED_SOURCE_CLOSURE": refuse()
    files=manifest["files"]
    if not isinstance(files,dict): refuse()
    for name,record in files.items():
        if not isinstance(name,str) or not name or name.startswith("/") or os.path.normpath(name)!=name or ".." in name.split("/") or name.split("/")[-1]==".env": refuse()
        if not isinstance(record,dict) or set(record)!={"sha256","bytes","executable"} or not isinstance(record["bytes"],int) or record["bytes"]<0 or not isinstance(record["sha256"],str) or len(record["sha256"])!=64 or not isinstance(record["executable"],bool): refuse()
    source_fd=checked_open(source,True)
    legacy_path="scripts/legacy-schema/manifest.v2.json"
    if legacy_path not in files: refuse()
    legacy_bytes,_=read_exact(source+"/"+legacy_path,files[legacy_path])
    if digest(legacy_bytes.replace(b"\r\n",b"\n"))!="dc4687bf45b8965de94acd93975218504c3294b9b3694ba0bd1c8a9a1faf3da4": refuse()
    inventory=json.loads(legacy_bytes)["source"]
    sources=inventory["sources"];migrations=inventory["migrations"]
    if not isinstance(sources,dict) or not isinstance(migrations,list) or len(migrations)!=76: refuse()
    migration_names=[m["name"] for m in migrations]
    if any(not isinstance(n,str) or not n or "/" in n or "\\" in n or n in (".","..") for n in migration_names) or len(set(migration_names))!=76: refuse()
    required={"package.json","scripts/fresh-target/exclusiveTargetController.js","scripts/fresh-target/contract.js",
              "scripts/fresh-target/catalog.js","scripts/fresh-target/provision.js","scripts/fresh-target/cli.js",
              "scripts/fresh-target/profile.v1.json",legacy_path,"prisma/migrations/migration_lock.toml",
              "node_modules/postgres/package.json"}
    required.update("node_modules/postgres/src/"+x+".js" for x in ("index","types","connection","query","queue","errors","subscribe","large","result","bytes"))
    required.update(sources)
    required.update("prisma/migrations/"+name+"/migration.sql" for name in migration_names)
    if not required.issubset(files): refuse()
    runtime_bytes,runtime_stat=read_exact(runtime,manifest["runtime"])
    original_source=stable(os.fstat(source_fd))
    records={}
    try:
        # Intake is treated only as bytes; nothing below is imported or spawned.
        for name,record in files.items():
            _,records[name]=read_exact(source+"/"+name,record)
        if stable(os.stat(source,follow_symlinks=False))!=original_source: refuse()
        if mode=="--verify-intake":
            print(json.dumps({"status":"INTAKE_BYTES_VERIFIED","uid":os.getuid(),"identitySha256":pin,"files":len(files),"applicationEvaluations":0,"databaseConnections":0,"migrationProcesses":0}))
            return
        if os.getuid()!=0 or sys.platform!="linux": refuse()
        root_path("/var/lib")
        if not os.path.exists(BASE): os.mkdir(BASE,0o711)
        root_path(BASE)
        dest=tempfile.mkdtemp(prefix="trust-",dir=BASE);os.chmod(dest,0o755)
        snapshot=dest+"/source";os.mkdir(snapshot,0o755)
        for name,record in files.items():
            path=snapshot+"/"+name;os.makedirs(os.path.dirname(path),mode=0o755,exist_ok=True)
            data,observed=read_exact(source+"/"+name,record)
            if observed!=records[name]: refuse()
            fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o555 if record["executable"] else 0o444)
            try:
                with os.fdopen(fd,"wb") as out: out.write(data);out.flush();os.fsync(out.fileno())
            except BaseException: raise
        if stable(os.stat(source,follow_symlinks=False))!=original_source: refuse()
        if read_exact(runtime,manifest["runtime"])[1]!=runtime_stat: refuse()
        # All subsequent privileged executable/import paths have root-only
        # non-writable ancestors. No use of the original source paths follows.
        with open(dest+"/node","xb") as out: out.write(runtime_bytes);out.flush();os.fsync(out.fileno())
        os.chmod(dest+"/node",0o555)
        with open(dest+"/identity.json","xb") as out: out.write(raw);out.flush();os.fsync(out.fileno())
        os.chmod(dest+"/identity.json",0o444)
        for current,dirs,names in os.walk(snapshot,topdown=False):
            for name in names:
                path=current+"/"+name
                if digest(open(path,"rb").read())!=files[os.path.relpath(path,snapshot)]["sha256"]: refuse()
            os.chmod(current,0o555)
        os.chmod(dest,0o555);root_path(dest)
        print(json.dumps({"status":"ROOT_SOURCE_SEALED","uid":os.getuid(),"identitySha256":pin,"files":len(files),"snapshot":snapshot,"runtime":dest+"/node","applicationEvaluations":0,"databaseConnections":0,"migrationProcesses":0}),flush=True)
        info=BASE+"/info-"+label+".json"
        if os.path.lexists(info): refuse()
        os.execve(dest+"/node",[dest+"/node",snapshot+"/scripts/fresh-target/exclusiveTargetController.js","--serve",snapshot,info],{"PATH":"/usr/sbin:/usr/bin:/bin","HOME":"/root","LANG":"C.UTF-8","LUMI_CONTROLLER_SOURCE_IDENTITY":pin})
    finally: os.close(source_fd)
try: main()
except BaseException as e:
    if isinstance(e,KeyboardInterrupt): raise
    print("PRIVILEGED_SOURCE_UNQUALIFIED:"+type(e).__name__,file=sys.stderr)
    sys.exit(1)
```
<!-- F01_BOOTSTRAP_END -->

Any change to this bootstrap literal invalidates its previously reviewed digest.
The operator must obtain a **new, independently approved literal pin** and
independently approved complete source/runtime identity before `--launch`.
A digest computed by this PR, a local test, or the candidate itself is NOT an
external approval. Until those pins and retained-host proof exist: **HOLD**.

Each cell has separate network, mount and PID namespaces. Its only network
interface is loopback; it contains exactly its owned PostgreSQL server and no
route to a parent namespace or second physical cluster. A private chroot exposes
read-only source/dependencies/tools, its own control leases, private temporary
storage and only its own PostgreSQL socket/data mounts. Other cluster sockets,
host `/proc`, homes, Windows mounts and Docker sockets are absent. PostgreSQL
runs as a different OS UID (1001); writer UID 1000 cannot read its bootstrap
password or data files. Administrative audit connections use independently held
SCRAM credentials and close before application preflight. No trust HBA rule or
application superuser capability is introduced.

The root supervisor keeps only SETUID, SETGID, SETPCAP and KILL for its owned
children. PostgreSQL, the operator, Prisma CLI, native engine and descendants
have zero inherited/permitted/effective/bounding/ambient capabilities and
`NoNewPrivs=1`. A fixed x86-64 seccomp filter, installed with the existing
Python standard library before Node starts, is inherited across every fork and
exec. It denies bind/listen, namespace changes, inherited keyring operations,
io_uring entry points and socket families outside
AF_UNIX/AF_INET/AF_INET6. This prevents a writer descendant from creating a
replacement PostgreSQL listener and prevents non-namespaced AF_VSOCK escape.
No new package is installed. Kernel status and live denied-syscall probes, not
a filter hash alone, are required evidence. The trusted outer namespace setup is privileged; it is not a
migration writer. The root controller observes process UIDs, start identities,
namespace membership, executable identity, the operator root and inherited FDs
independently through host `/proc`. It also verifies PG17's system identifier
against the owned data directory and validates the approved database OID and
scoped login before launching the operator. The operator performs its original
identity/bootstrap checks again inside that enforced boundary.

Only a private operator checkpoint FD is inherited by the operator. Prisma's
stdio is explicitly restricted to stdin/stdout/stderr; it receives no controller
channel, ambient environment, alternate engine override or host socket. The
existing strict CA verification, exact native engine revision, five-module
artifact seal and all 76 immutable SQL buffers remain required. The sanitized
Linux child PATH additionally includes the cell's read-only system tool paths
so the unchanged Prisma CLI can detect installed OpenSSL without downloading or
rewriting engines. Both datasource variables are constructed from one approved
URL. The same original native issuer performs schema/history initialization,
DDL and receipt INSERT/UPDATE operations; migrations are not SQL-rewritten or
wrapped and receipts are never repaired.

The controller monitors lease validity and owned descendants throughout the
job. Approval/policy loss kills the owned writer UID and requires independent
absence before any successful response. Uncertain termination quarantines the
cell; PostgreSQL teardown refuses while a writer is still owned. Namespace PID1
exit supplies the kernel fence for descendants, including on loss of its parent
control input. No failed or lost-response operation is automatically replayed.
An unavailable response does not prove rollback: only independent catalog and
native receipt observations can describe the remaining state. Target data
directories and controller journals are retained after shutdown.

`FRESH_TARGET_EXCLUSIVE_CONTROLLER_INFO` is an external owned-lab test fixture
input, not a runtime configuration switch. The five-case test keeps its 30s
deadline and real native invocations. A/B deliberately accept copied credentials
with the same database/user and TLS identity; only their physical identifiers
differ. Additional tests interrupt actual backends at initialization, receipt
insertion, migration DDL and final receipt update using explicit, isolated fault
barriers. Those barriers never manufacture receipts and remain in their own
negative databases. The positive native profile contains none of them. Lost
controller response is distinguished from untested loss of a PostgreSQL wire
commit acknowledgment. A stopped live writer exercises refusal/quarantine;
tests do not claim to reproduce a kernel-uninterruptible SIGKILL failure.

Source and evidence review must evaluate the privileged controller as part of
the trust boundary. Root compromise, kernel escape, hosted poolers, real hosted
DNS/network enforcement, provider administrator constraints and operator
deployment are NOT_QUALIFIED. No local PASS authorizes publication, activation,
production migration, deployment or gate closure. Actual executed results and
all failed attempts belong to the external immutable evidence package.

## 03B-9A test-only protocol qualification candidate

The three `freshTargetBindingProtocol*` files under `src/tests/` are synthetic
fixtures and tests, not a replacement migration executor. No production module
imports the candidate, and this slice does not change the provisioning refusal,
approval authority, native/permission profile, startup admission or runtime.

The fixture places an invoker `DO` assertion and the authorized payload into one
PostgreSQL Simple Query (`Q`) message. It checks system identifier, database OID
and name, PG17, authenticated session user and effective role using
`IS DISTINCT FROM`; any mismatch raises before the payload. Invalid or NULL
claims fail before dispatch. Catalog observers use separate administrative
connections outside the candidate's measured wire window.

A loopback-only plaintext protocol fixture reassembles actual TCP bytes into
PostgreSQL messages, records each Q's length, SHA256 and base64 bytes, and routes
whole Q messages independently to two test-owned physical clusters. This models
backend switching without assuming session affinity. It is not a certified
pooler and cannot establish safety of an intermediary that splits/reorders SQL,
forges identity responses or terminates TLS. The raw trace omits authentication
and cancellation key material. No private keys are created by this fixture.

The separate-prequery negative control intentionally writes synthetic data to
the wrong lab target, proving that the control can observe the original hazard.
The candidate must instead raise before B's payload; complete catalog, receipt,
ACL and synthetic application snapshots are compared independently. Database
OIDs are cluster-local and may coincide across clusters; the system/OID tuple,
not a globally unique OID assumption, identifies the target.

Compatibility experiments submit all 76 original migration payloads unchanged,
including migration76's embedded BEGIN/COMMIT, then the 26 existing legacy DDL
statements and reviewed ownership/grant phases. Receipt records in that
experiment are explicitly **TEST_CANDIDATE_NOT_PRISMA**. Matching checksums,
schema, successful fields and native profile do not prove equivalent Prisma
timestamp/UUID/failure provenance or authorize a new receipt issuer. No migration
file, source manifest, permission profile or production executor is changed.

A failed candidate lease becomes terminal. Cancellation, failed explicit
transactions, session advisory locks and loss of the commit acknowledgement are
separate experiments; a failed response must never be interpreted as rollback
of an already committed payload. The synthetic failure logger is an explicit
separate experiment, not an automatic production repair/retry.

No existing timeout or assertion is relaxed. Full verification requires the
existing opt-in `REQUIRE_DB=1`, explicit owned native PG17 binaries on Windows,
or the existing cached PG17 Docker image/local Unix socket on Linux. There is
no remote fallback, image pull or dependency installation in these fixtures.
Physical IDs, raw protocol boundaries, RED/GREEN results, compatibility limits,
failed runs and teardown belong in the accompanying immutable evidence report.

Measured local qualification includes 20 focused tests with zero skips and an
unchanged full backend run of 7,629 tests with zero failures or skips. Earlier
fixture and full-run failures remain in the external 03B-9A evidence; they are
not replaced by the passing run. Raw Query frames include all 76 exact migration
payloads and the independently observed wrong-target refusal. These results
qualify this test candidate only, not a production receipt issuer or transport.

**Production implementation remains NO-GO** until independent review qualifies
receipt issuer semantics, transport/directness, role transitions, connection
lifetime and failure handling. Session/transaction/statement poolers, real DNS
mutation, TLS interception and arbitrary SQL-aware proxies are not qualified by
these local plaintext experiments. A future production file allowlist is only
a proposal and needs Omar's separate explicit approval. Gates B/C stay BLOCKED.

**Issue611 containment:** mutating provisioning accepts only the exact host
`127.0.0.1` for an independently verified, directly connected owned synthetic
local lab. Every valid nonliteral host (including `localhost`, other loopback
addresses and aliases) returns `REFUSED / MIGRATION_TARGET_BINDING_UNQUALIFIED /
INPUT` before constructing a database client, opening a network connection,
starting a migration child or executing DDL. A CA or approval digest does not
override this refusal. Invalid approval/source checks still fail first.
Read-only `inspect` retains strict TLS and the existing full identity/native/
receipt checks; it is not permission to access a hosted target.

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
`artifactSha256`. It binds the five implementation modules (including the exclusive controller), pinned profile, frozen source inventory and all26
DDL statement hashes. Do not obtain it by accepting an operator manifest.

Non-loopback postgres.js connections require CA and `rejectUnauthorized:true`.
The retained Prisma child configuration uses `sslmode=require`, `sslaccept=strict`,
and the same CA, but nonloopback mutating execution is now refused before that
child is reachable. There is no plaintext fallback or operator SSL-mode override. These are
[Prisma's connector parameters](https://docs.prisma.io/docs/orm/v6/overview/databases/postgresql).
Unit tests verify strict configuration/refusal; real hosted TLS qualification
remains NOT_TESTED. Literal `127.0.0.1` is only the direct owned local-lab
exception; a local proxy/reroute must not be treated as direct target authority.

## Migration-connection binding limitation and containment evidence

Issue611's actual trusted-TLS route experiment verified physical target A in
the operator session, then routed the separate Prisma connections to B. Both
databases began empty. B received all76 exact migration receipts while A received
the four legacy tables; the later PERMISSIONS refusal did not undo either
transaction's writes. TLS authenticates the configured peer name/chain, not
the independently approved physical systemID/databaseOID across new sessions.

The containment withdraws this unqualified nonloopback mutating path; it does
not repair the separate migration connection, certify literal-loopback proxies,
or introduce hosted compatibility or runtime admission. Any future expansion
must bind the actual DDL connection(s) to approved physical identity/DB/role.
A separate pre-query, CA/hostname alone or post-write inspection is insufficient.
No migration, native seal, permission profile or approval authority is relaxed.

Regression coverage retains every direct provisioning/native/permission case,
strict TLS configuration through read-only inspection, and invalid-source trust
checks. New alias/CA unit cases assert refusal before driver/child construction.
A real two-physical-cluster trusted-TLS route fixture records empty native
catalogs/receipts before invocation, zero network/router/migration-child activity
on refusal, and identical catalogs/receipts afterward. Both TLS endpoints and
real TLS inspection have positive controls; the existing direct provision
proves the migration-child observer is active. Existing timeout limits remain
unchanged. Native Windows tests explicitly supply
`FRESH_TARGET_TEST_OPENSSL_BIN`; Linux uses its installed `openssl`. No tool is
installed or downloaded by the test. Temporary keys are destroyed after owned
servers stop. Immutable RED/GREEN results and independent evidence belong to
the focused containment PR; the earlier failed route evidence is preserved.
Windows PG startup captures output in owned temporary files because inherited
daemon pipes were measured to make `spawnSync` time out after exit0. The same
20-second subprocess bound remains, and any subprocess error now fails the
fixture regardless of status. No production code or timeout is changed by
that test-harness correction.

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
password, customer row or provider credential is returned. Only bounded, sanitized Prisma command output is recorded. No provider request, backfill, account selection or onboarding
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

## Persistent laboratory evidence

Retained controller roots use only `/var/lib/lumi-exclusive-613/controller-*`. Before activation the controller rejects symlinked or writable-by-others ancestors, unexpected ownership/permissions, non-ext4 or read-only mounts, inadequate free space and missing filesystem UUID. A flushed storage record proves writability. There is no temporary-directory fallback. Journals, server-log exports and lease records are flushed and closed per write. Private chroot scratch paths remain separate from the retained-root policy.

Independent external receipts must hash the stopped physical data, journals and leases, export sanitized copies before stopping the environment, reopen them from another process, and verify identity and integrity again after a safe controlled environment restart. A location name or successful shutdown alone does not prove retention. Auxiliary fixtures receive an externally qualified persistent TMPDIR. Passwords, private keys and physical authentication files remain protected in the retained Linux directories and are not exported as raw public evidence. Retention failure keeps the candidate HOLD; no historical missing files may be reconstructed as originals.

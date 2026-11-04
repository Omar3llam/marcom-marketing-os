// Synthetic-only Linux controller. Importing this module performs no I/O.
// The explicit root CLI owns only new task directories and private namespaces.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, readlinkSync, readdirSync, lstatSync, statSync, realpathSync,
  existsSync, mkdirSync, mkdtempSync, chmodSync, chownSync, appendFileSync, statfsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const sha = b => createHash('sha256').update(b).digest('hex');
const refused = () => { throw Error('MIGRATION_TARGET_BINDING_UNQUALIFIED'); };
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const ns = pid => Object.fromEntries(['net','mnt','pid'].map(k => [k, readlinkSync(`/proc/${pid}/ns/${k}`)]));
const RETAINED_BASE = '/var/lib/lumi-exclusive-613';

// Reserve before the first await: concurrent socket requests must never share
// one cell's controller state or replace its writer message handler.
export async function withExclusiveCellReservation(cell, operation) {
  if (cell.exit || cell.jobs.size || cell.quarantined || cell.reserved) throw Error('CELL_NOT_IDLE');
  cell.reserved = true;
  try { return await operation(); }
  finally { cell.reserved = false; }
}

export function assertExclusiveCellStopReady(cell) {
  if (cell.jobs.size || cell.reserved) throw Error('WRITER_TERMINATION_UNCERTAIN');
}

/** Read-only qualification; a location name alone is not persistence proof. */
export function qualifyRetainedStorage(path) {
  if(process.platform!=='linux'||path!==RETAINED_BASE)throw Error('RETAINED_STORAGE_UNQUALIFIED');
  let parent=path;
  while(parent!=='/'){
    const s=lstatSync(parent);
    if(s.isSymbolicLink()||!s.isDirectory()||s.uid!==0||(s.mode&0o022))throw Error('RETAINED_STORAGE_UNQUALIFIED');
    parent=dirname(parent);
  }
  const s=lstatSync(path),fs=statfsSync(path);
  if(s.uid!==0||(s.mode&0o777)!==0o711||realpathSync(path)!==path||fs.type!==0xef53||fs.bavail<32768)throw Error('RETAINED_STORAGE_UNQUALIFIED');
  const mounts=readFileSync('/proc/self/mountinfo','utf8').trim().split('\n').map(line=>{
    const [before,after]=line.split(' - '),fields=before.split(' '),tail=after.split(' ');
    return{mountPoint:fields[4],device:fields[2],options:fields[5],type:tail[0],source:tail[1]};
  }).filter(m=>path===m.mountPoint||path.startsWith(m.mountPoint==='/'?'/':m.mountPoint+'/')).sort((a,b)=>b.mountPoint.length-a.mountPoint.length);
  const mount=mounts[0];
  if(!mount||mount.type!=='ext4'||!/^\/dev\/[a-z0-9]+$/.test(mount.source)||!mount.options.split(',').includes('rw'))throw Error('RETAINED_STORAGE_UNQUALIFIED');
  return {path,uid:s.uid,mode:s.mode&0o777,device:s.dev,filesystemType:'ext4',mount};
}


/** Defense in depth AFTER the independent OS bootstrap has authenticated this
 * entrypoint. It cannot make direct Root execution of a writable entry safe. */
export function qualifyTrustedControllerSource(sourceRoot) {
  const trust = dirname(sourceRoot), pin = process.env.LUMI_CONTROLLER_SOURCE_IDENTITY;
  if (!/^\/var\/lib\/lumi-exclusive-613\/trust-[a-zA-Z0-9_-]+\/source$/.test(sourceRoot)
    || !/^[a-f0-9]{64}$/.test(pin || '')
    || fileURLToPath(import.meta.url) !== join(sourceRoot, 'scripts/fresh-target/exclusiveTargetController.js')
    || process.execPath !== join(trust, 'node')) throw Error('PRIVILEGED_SOURCE_UNQUALIFIED');
  const owned = path => {
    let at = path;
    while (true) {
      const s = lstatSync(at);
      if (s.isSymbolicLink() || s.uid !== 0 || (s.mode & 0o022)) throw Error('PRIVILEGED_SOURCE_UNQUALIFIED');
      if (at === '/') break;
      at = dirname(at);
    }
  };
  owned(sourceRoot); owned(join(trust, 'identity.json')); owned(process.execPath);
  const identityBytes = readFileSync(join(trust, 'identity.json'));
  if (sha(identityBytes) !== pin) throw Error('PRIVILEGED_SOURCE_UNQUALIFIED');
  const identity = JSON.parse(identityBytes);
  if (identity.version !== 1 || identity.scope !== 'F01_REVIEWED_SOURCE_CLOSURE'
    || sha(readFileSync(process.execPath)) !== identity.runtime.sha256) throw Error('PRIVILEGED_SOURCE_UNQUALIFIED');
  for (const [path, record] of Object.entries(identity.files)) {
    if (path.startsWith('/') || path.split('/').some(x => x === '..' || x === '.' || !x)) throw Error('PRIVILEGED_SOURCE_UNQUALIFIED');
    const full = join(sourceRoot, path); owned(full);
    const s = lstatSync(full);
    if (!s.isFile() || (s.mode & 0o222) || s.nlink !== 1 || s.size !== record.bytes
      || sha(readFileSync(full)) !== record.sha256) throw Error('PRIVILEGED_SOURCE_UNQUALIFIED');
  }
  return Object.freeze({ identitySha256: pin, sourceRoot, runtime: process.execPath,
    files: Object.keys(identity.files).length, rootOwnedAncestors: true });
}

// Existing Python stdlib is only a syscall launcher, not a dependency or a
// privileged writer. NoNewPrivs makes this inherited filter irreversible.
// Deny listener creation and io_uring bypasses, and reject socket families
// (including AF_VSOCK) which are not bounded by this cell's network namespace.
const WRITER_FILTER = `import ctypes, os, sys
class Filter(ctypes.Structure):
    _fields_=[('code',ctypes.c_ushort),('jt',ctypes.c_ubyte),('jf',ctypes.c_ubyte),('k',ctypes.c_uint32)]
class Program(ctypes.Structure):
    _fields_=[('len',ctypes.c_ushort),('filter',ctypes.POINTER(Filter))]
instructions=[]
def add(code,k,jt=0,jf=0): instructions.append(Filter(code,jt,jf,k))
add(0x20,4)
add(0x15,0xc000003e,1,0)
add(0x06,0x80000000)
add(0x20,0)
add(0x35,0x40000000,0,1)
add(0x06,0x80000000)
for nr in (49,50,248,249,250,272,308,425,426,427):
    add(0x15,nr,0,1)
    add(0x06,0x00050001)
add(0x15,435,0,1)
add(0x06,0x00050026)
add(0x15,56,0,4)
add(0x20,16)
add(0x45,0x7e020000,0,1)
add(0x06,0x00050001)
add(0x06,0x7fff0000)
for nr in (41,53):
    add(0x15,nr,0,6)
    add(0x20,16)
    add(0x15,1,3,0)
    add(0x15,2,2,0)
    add(0x15,10,1,0)
    add(0x06,0x00050001)
    add(0x06,0x7fff0000)
add(0x06,0x7fff0000)
array=(Filter*len(instructions))(*instructions)
program=Program(len(instructions),array)
libc=ctypes.CDLL(None,use_errno=True)
if libc.prctl(38,1,0,0,0) != 0 or libc.prctl(22,2,ctypes.byref(program),0,0) != 0:
    raise OSError(ctypes.get_errno(),'writer syscall boundary unavailable')
os.execve(sys.argv[1],sys.argv[1:],dict(os.environ))
`;

/** Kernel observations, not a caller-supplied policy assertion. */
export function assertExclusiveTargetBoundary(target, leaseFile, expectedHash) {
  if (process.platform !== 'linux' || process.getuid() === 0
    || !/^\/control\/jobs\/[a-f0-9]{32}\/lease.json$/.test(leaseFile || '')) refused();
  for (const path of ['/control', dirname(leaseFile), leaseFile]) {
    const s = lstatSync(path); if (s.isSymbolicLink() || s.uid !== 0 || (s.mode & 0o022)) refused();
  }
  const bytes = readFileSync(leaseFile); if (sha(bytes) !== expectedHash) refused();
  const lease = JSON.parse(bytes), status = readFileSync('/proc/self/status','utf8');
  if (!plain(lease) || lease.version !== 1 || lease.scope !== 'OWNED_SYNTHETIC_LINUX_CELL'
    || lease.expiresAt <= Date.now() || JSON.stringify(lease.target) !== JSON.stringify(target)
    || lease.appPid !== process.pid || process.getuid() !== lease.writerUid
    || ['CapInh','CapPrm','CapEff','CapBnd','CapAmb'].some(k => !new RegExp('^'+k+':\\s+0+$','m').test(status))
    || !/^NoNewPrivs:\s+1$/m.test(status) || !/^Seccomp:\s+2$/m.test(status)
    || lease.seccompSha256 !== sha(WRITER_FILTER) || JSON.stringify(ns('self')) !== JSON.stringify(lease.namespaces)) refused();
  const dev = readFileSync('/proc/net/dev','utf8').trim().split('\n').slice(2).map(l => l.split(':')[0].trim());
  if (dev.length !== 1 || dev[0] !== 'lo' || existsSync('/run/docker.sock') || existsSync('/mnt/c')) refused();
  const mounts = readFileSync('/proc/self/mountinfo','utf8').split('\n').filter(Boolean).map(l => l.split(' '));
  for (const path of ['/source','/usr','/control']) if (!mounts.some(m => m[4] === path && m[5].split(',').includes('ro'))) refused();
  if (readlinkSync('/proc/self/root') !== '/') refused();
  const stat = readFileSync(`/proc/${lease.postgresPid}/stat`,'utf8');
  // The database OS uid is deliberately different. Its protected executable
  // and namespace are independently inspected by the root controller.
  if (stat.slice(stat.lastIndexOf(')')+2).split(' ')[19] !== lease.postgresStart) refused();
  return Object.freeze({ leaseFile, expectedHash, cellId: lease.cellId });
}

/** A private inherited channel belongs to the unprivileged operator, never Prisma. */
export async function exclusiveWriterCheckpoint(boundary, target) {
  assertExclusiveTargetBoundary(target, boundary.leaseFile, boundary.expectedHash);
  const channel = new net.Socket({ fd: 3, readable: true, writable: true });
  await new Promise((resolve, reject) => {
    let text = '';
    channel.on('data', b => { text += b; if (text.includes('\n')) text.trim() === 'CONTINUE' ? resolve() : reject(Error('MIGRATION_TARGET_BINDING_UNQUALIFIED')); });
    channel.once('error', reject); channel.once('end', () => reject(Error('MIGRATION_TARGET_BINDING_UNQUALIFIED')));
    channel.write(JSON.stringify({ kind: 'WRITER_CHECKPOINT', pid: process.pid, cellId: boundary.cellId })+'\n');
  });
  channel.destroy();
  assertExclusiveTargetBoundary(target, boundary.leaseFile, boundary.expectedHash);
}

function checked(exe, args, options = {}) {
  const r = spawnSync(exe,args,{encoding:'utf8',timeout:20000,...options});
  if (r.error || r.signal || r.status !== 0) throw Error(`CONTROL_COMMAND_FAILED:${exe}:${r.error?.code || r.status}:${r.stderr || ''}`);
  return r.stdout;
}

// Fixed adversarial probe for owned synthetic cells. It has no privileged
// operation: the same kernel boundary applies to the real native CLI here.
export async function probeExclusiveCell(probe, boundary, target) {
  assertExclusiveTargetBoundary(target,boundary.leaseFile,boundary.expectedHash);
  if(process.getuid()!==1000||!plain(probe))refused();
  const requested=new URL(probe.url);
  // A negative probe may address only an unused loopback port in this cell.
  // It cannot become an alternate writer for the live approved endpoint.
  if(requested.hostname!=='127.0.0.1'||Number(requested.port)<1024||Number(requested.port)===5432
    ||requested.pathname!=='/'+target.database||decodeURIComponent(requested.username)!==target.login||requested.search)refused();
  const status=readFileSync('/proc/self/status','utf8');
  if(!/^NoNewPrivs:\s+1$/m.test(status)||!/^CapBnd:\s+0+$/m.test(status))refused();
  const postgres=(await import('postgres')).default;
  const preflight=postgres({host:target.host,port:target.port,database:target.database,username:target.login,
    password:decodeURIComponent(requested.password),ssl:{rejectUnauthorized:true,ca:probe.caPem},max:1,onnotice:()=>{}});
  let observed;
  try{[observed]=await preflight`SELECT system_identifier::text AS system,current_database() AS database,session_user AS login,
    (SELECT oid::int FROM pg_database WHERE datname=current_database()) AS oid FROM pg_control_system()`;
    if(observed.system!==target.systemIdentifier||observed.database!==target.database||observed.login!==target.login||observed.oid!==target.databaseOid)refused();
  }finally{await preflight.end();}
  const attempts={};
  attempts.listener = await new Promise(resolve=>{
    const server=net.createServer();server.once('error',e=>resolve({denied:true,error:e.code}));
    server.listen(0,'127.0.0.1',()=>server.close(()=>resolve({denied:false})));
  });
  const socketFamily=spawnSync('/usr/bin/python3',['-I','-S','-c',"import socket,json\ntry:\n s=socket.socket(40,socket.SOCK_STREAM);print(json.dumps({'denied':False}));s.close()\nexcept OSError as e:print(json.dumps({'denied':True,'errno':e.errno}))"],{encoding:'utf8',timeout:1000});
  if(socketFamily.status!==0)refused();attempts.nonNamespacedSocket=JSON.parse(socketFamily.stdout);
  for(const [name,path] of Object.entries({hostRoot:'/proc/1/root',database:'/pgdata/PG_VERSION',adminCredential:'/bootstrap/password',foreignSocket:probe.foreignSocket})){
    try{name==='hostRoot'?readlinkSync(path):readFileSync(path);attempts[name]={denied:false};}
    catch(e){attempts[name]={denied:true,error:e.code};}
  }
  for(const [name,exe,args] of [['networkNamespace','/usr/bin/unshare',['--net','/usr/bin/true']],
    ['userNamespace','/usr/bin/unshare',['--user','--map-root-user','/usr/bin/true']],
    ['namespaceEntry','/usr/bin/nsenter',['--net=/proc/1/ns/net','/usr/bin/true']],
    ['mount','/usr/bin/mount',['--bind','/usr','/work']]]){
    const r=spawnSync(exe,args,{encoding:'utf8',timeout:1000});attempts[name]={exit:r.status,signal:r.signal,error:r.error?.code,stderr:r.stderr};
  }
  const folder=mkdtempSync('/tmp/native-negative-'),ca=join(folder,'ca.crt');writeFileSync(ca,probe.caPem,{mode:0o600});
  const url=new URL(probe.url);url.searchParams.set('sslmode','require');url.searchParams.set('sslcert',ca);url.searchParams.set('sslaccept','strict');
  const engines='/source/node_modules/@prisma/engines/',engine=readdirSync(engines).filter(n=>/^schema-engine-/.test(n)&&!n.endsWith('.exe'));
  if(engine.length!==1)refused();
  const env={PATH:'/tools:/usr/bin:/usr/sbin:/bin',HOME:folder,TEMP:folder,TMP:folder,DATABASE_URL:url.href,DIRECT_URL:url.href,
    CHECKPOINT_DISABLE:'1',PRISMA_HIDE_UPDATE_MESSAGE:'1',PRISMA_SCHEMA_ENGINE_BINARY:engines+engine[0]};
  const result=await new Promise((resolve,reject)=>{
    const child=spawn('/tools/node',['/source/node_modules/prisma/build/index.js','migrate','deploy','--schema','/source/prisma/schema.prisma'],{cwd:folder,env,stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.once('error',reject);
    child.once('close',(code,signal)=>resolve({code,signal,output:output.replaceAll(decodeURIComponent(url.password),'<credential>')}));
  });
  return {preflight:observed,attempts,native:result};
}

// This function executes as PID1 only after private mounts/network are set up.
// It retains SETUID/SETGID/SETPCAP/KILL for owned children, never NET_ADMIN/SYS_ADMIN.
async function cellSupervisor() {
  const fs = await import('node:fs'), cp = await import('node:child_process'), rl = await import('node:readline');
  const lines = rl.createInterface({input:process.stdin}); let configured = false, config, pg;
  const jobs = new Map();
  const send = data => process.stdout.write(JSON.stringify(data)+'\n');
  const run = (exe,args,options={}) => new Promise((resolve,reject) => {
    const child=cp.spawn(exe,args,{env:{PATH:'/usr/lib/postgresql/17/bin:/usr/bin:/bin',HOME:'/pgdata',LANG:'C.UTF-8'},...options});
    let out='',err=''; child.stdout?.on('data',b=>out+=b);child.stderr?.on('data',b=>err+=b);
    child.once('error',reject);child.once('close',(code,signal)=>code===0&&!signal?resolve(out):reject(Error(`CHILD_FAILED:${code}:${signal}:${err}`)));
  });
  const privilegeArgs = uid => ['--reuid='+uid,'--regid='+uid,'--clear-groups','--no-new-privs',
    '--bounding-set=-all','--inh-caps=-all','--ambient-caps=-all'];
  for await (const text of lines) {
    const request=JSON.parse(text);
    try {
      if (!configured) {
        config=request; configured=true;
        await run('/usr/bin/setpriv',[...privilegeArgs(1001),'/usr/lib/postgresql/17/bin/initdb','-D','/pgdata',
          '-U','lab_fresh_admin','--auth-local=scram-sha-256','--auth-host=scram-sha-256','--pwfile=/bootstrap/password','--no-locale','--encoding=UTF8','--no-sync'],{stdio:['ignore','pipe','pipe']});
        const pgConfig="\nlisten_addresses='127.0.0.1'\nport=5432\nunix_socket_directories='/audit'\nlog_parameter_max_length=0\nlog_parameter_max_length_on_error=0\nlog_line_prefix='%m [%p] user=%u db=%d app=%a client=%h '\n";
        await run('/usr/bin/setpriv',[...privilegeArgs(1001),'/tools/node','--input-type=module','-e',
          `import {appendFileSync} from 'node:fs';appendFileSync('/pgdata/postgresql.conf',${JSON.stringify(pgConfig)});`],{stdio:['ignore','pipe','pipe']});
        pg=cp.spawn('/usr/bin/setpriv',[...privilegeArgs(1001),'/usr/lib/postgresql/17/bin/postgres','-D','/pgdata'],
          {env:{PATH:'/usr/bin:/bin',HOME:'/pgdata',LANG:'C.UTF-8'},stdio:['ignore','pipe','pipe']});
        for(const stream of [pg.stdout,pg.stderr])stream.on('data',b=>send({kind:'PG_LOG',data:b.toString()}));
        pg.once('error',e=>send({kind:'CELL_FATAL',error:e.code}));
        send({kind:'CELL_BOOTED',pid:process.pid,postgresPid:pg.pid}); continue;
      }
      if(request.method==='run'){
        const script=`import {writeSync} from 'node:fs';import {createInterface} from 'node:readline';writeSync(3,'OPERATOR_READY\\n');const lines=createInterface({input:process.stdin});for await(const line of lines){const r=JSON.parse(line);lines.close();let result;if(r.probe){const m=await import('/source/scripts/fresh-target/exclusiveTargetController.js');const q=JSON.parse((await import('node:fs')).readFileSync(r.input.approval.exclusiveTarget.qualificationFile));const boundary=m.assertExclusiveTargetBoundary(r.input.approval.target,q.kernelLeaseFile,q.kernelLeaseSha256);result=await m.probeExclusiveCell(r.probe,boundary,r.input.approval.target);}else{const m=await import('/source/scripts/fresh-target/provision.js');result=await m[r.inspect?'inspectFreshTarget':'provisionFreshTarget'](r.input);}console.log('EXCLUSIVE_APPLICATION_RESULT '+JSON.stringify(result));process.exitCode=r.probe?0:['PROVISIONED_MATCH','OBSERVED_MATCH'].includes(result.status)?0:1;break;}`;
        const job=cp.spawn('/usr/bin/setpriv',[...privilegeArgs(1000),'/usr/bin/python3','-I','-S','-c',config.writerFilter,'/tools/node','--input-type=module','-e',script],
          {env:{PATH:'/tools:/usr/bin:/bin',HOME:'/work',TMPDIR:'/tmp',LANG:'C.UTF-8',CHECKPOINT_DISABLE:'1',PRISMA_HIDE_UPDATE_MESSAGE:'1'},stdio:['pipe','pipe','pipe','pipe']});
        jobs.set(request.id,job);
        job.stdout.on('data',b=>send({kind:'JOB_STDOUT',id:request.id,data:b.toString()}));
        job.stderr.on('data',b=>send({kind:'JOB_STDERR',id:request.id,data:b.toString()}));
        let handshake='',ready=false;
        job.stdio[3].on('data',b=>{
          if(!ready){handshake+=b;const at=handshake.indexOf('\n');if(at<0)return;
            if(handshake.slice(0,at)!=='OPERATOR_READY'){job.kill('SIGKILL');return;}
            ready=true;send({kind:'JOB_STARTED',id:request.id,pid:job.pid});
            const rest=handshake.slice(at+1);if(rest)send({kind:'JOB_CHECKPOINT',id:request.id,data:rest});
          }else send({kind:'JOB_CHECKPOINT',id:request.id,data:b.toString()});
        });
        job.once('error',e=>send({kind:'JOB_ERROR',id:request.id,error:e.code}));
        job.once('close',(code,signal)=>{jobs.delete(request.id);send({kind:'JOB_CLOSED',id:request.id,code,signal});});
      }else if(request.method==='input') jobs.get(request.id)?.stdin.end(JSON.stringify(request.payload)+'\n');
      else if(request.method==='continue') jobs.get(request.id)?.stdio[3].end('CONTINUE\n');
      else if(request.method==='cancel'){
        // The supervisor owns every process in its PID namespace. Kill only
        // the fixed writer uid, including descendants which outlive their CLI.
        for(const p of fs.readdirSync('/proc').filter(p=>/^\d+$/.test(p))){
          try{if(/^Uid:\s+1000\s/m.test(fs.readFileSync('/proc/'+p+'/status','utf8')))process.kill(Number(p),'SIGKILL');}
          catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}
        }
      }
      else if(request.method==='stop'){
        if(jobs.size)throw Error('WRITERS_STILL_OWNED');
        await run('/usr/bin/setpriv',[...privilegeArgs(1001),'/usr/lib/postgresql/17/bin/pg_ctl','-D','/pgdata','-m','fast','-w','stop'],{stdio:['ignore','pipe','pipe']});
        send({kind:'CELL_STOPPED'});process.exitCode=0;lines.close();break;
      }else throw Error('METHOD_UNQUALIFIED');
    }catch(e){send({kind:'CELL_ERROR',id:request.id,error:e.message});}
  }
  // PID1 exit is a kernel fence: the PID namespace cannot outlive its init.
  process.exit(jobs.size?1:0);
}

async function namespaceSetup(config) {
  const fs=await import('node:fs'),cp=await import('node:child_process');
  const cmd=(exe,args)=>{const r=cp.spawnSync(exe,args,{encoding:'utf8',timeout:20000});if(r.error||r.signal||r.status!==0)throw Error('NAMESPACE_SETUP_FAILED:'+exe+':'+r.stderr);};
  const root=config.rootfs;
  cmd('/usr/bin/mount',['--make-rprivate','/']);
  const bind=(from,to,ro=true)=>{cmd('/usr/bin/mount',['--bind',from,root+to]);if(ro)cmd('/usr/bin/mount',['-o','remount,bind,ro',root+to]);};
  for(const path of ['/usr','/bin','/sbin','/lib','/lib64'])if(fs.existsSync(path)){fs.mkdirSync(root+path,{recursive:true});bind(path,path);}
  bind(config.snapshot,'/source');bind(config.control,'/control');bind(config.data,'/pgdata',false);bind(config.audit,'/audit',false);
  bind(config.node,'/tools/node');bind(config.bootstrap,'/bootstrap');
  cmd('/usr/bin/mount',['-t','proc','proc',root+'/proc']);
  for(const n of ['null','zero','random','urandom'])bind('/dev/'+n,'/dev/'+n,false);
  cmd('/usr/sbin/ip',['link','set','lo','up']);
  const env={PATH:'/tools:/usr/bin:/bin',HOME:'/work',LANG:'C.UTF-8'};
  process.execve('/usr/sbin/chroot',['chroot',root,'/usr/bin/setpriv','--no-new-privs',
    '--bounding-set=-all,+setuid,+setgid,+setpcap,+kill','--inh-caps=-all','--ambient-caps=-all',
    '/tools/node','--input-type=module','-e',`(${config.supervisor})()`],env);
}

/** Independent host-side process observation; never trusts child-reported caps. */
function namespaceMembers(namespace) {
  const out=[];
  for(const pid of readdirSync('/proc').filter(p=>/^\d+$/.test(p))){
    try{if(readlinkSync(`/proc/${pid}/ns/net`)!==namespace)continue;
      const status=readFileSync(`/proc/${pid}/status`,'utf8'),stat=readFileSync(`/proc/${pid}/stat`,'utf8');
      out.push({pid:Number(pid),name:readFileSync(`/proc/${pid}/comm`,'utf8').trim(),
        nspid:status.match(/^NSpid:\s+(.+)$/m)?.[1].trim().split(/\s+/).map(Number),
        uid:status.match(/^Uid:\s+(\d+)/m)?.[1],capEff:status.match(/^CapEff:\s+(\w+)/m)?.[1],
        capBnd:status.match(/^CapBnd:\s+(\w+)/m)?.[1],noNewPrivs:status.match(/^NoNewPrivs:\s+(\d+)/m)?.[1],
        seccomp:status.match(/^Seccomp:\s+(\d+)/m)?.[1],seccompFilters:status.match(/^Seccomp_filters:\s+(\d+)/m)?.[1],
        executable:readlinkSync(`/proc/${pid}/exe`),
        start:stat.slice(stat.lastIndexOf(')')+2).split(' ')[19],namespaces:ns(pid)});
    }catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}
  }return out;
}

export async function serveExclusiveController(sourceRoot, infoFile) {
  if(process.platform!=='linux'||process.arch!=='x64'||process.getuid()!==0||process.version!=='v24.20.0')throw Error('SYNTHETIC_CONTROLLER_PREREQUISITE');
  const trustedSource=qualifyTrustedControllerSource(sourceRoot);
  if(existsSync(join(sourceRoot,'.env')))throw Error('SOURCE_SCOPE_UNQUALIFIED');
  if(!new RegExp('^'+RETAINED_BASE+'/info-[a-zA-Z0-9]{1,40}\\.json$').test(infoFile)||existsSync(infoFile))throw Error('INFO_SCOPE_UNQUALIFIED');
  // This retained root must survive normal shutdown and environment restart.
  // Temporary chroot scratch space remains inside it; there is no /tmp fallback.
  if(!existsSync(RETAINED_BASE))mkdirSync(RETAINED_BASE,{mode:0o711});
  const storage=qualifyRetainedStorage(RETAINED_BASE);
  const filesystemUuid=checked('/usr/sbin/blkid',['-s','UUID','-o','value',storage.mount.source]).trim();
  if(!/^[a-f0-9-]{36}$/.test(filesystemUuid))throw Error('RETAINED_STORAGE_UNQUALIFIED');
  const root=mkdtempSync(join(RETAINED_BASE,'controller-'));chmodSync(root,0o711);
  const storageRecord={...storage,filesystemUuid,root,createdAt:new Date().toISOString()};
  // The flushed regular record also proves storage is writable before activation.
  writeFileSync(join(root,'STORAGE.json'),JSON.stringify(storageRecord,null,2),{mode:0o444,flag:'wx',flush:true});
  const snapshot=sourceRoot,node=process.execPath;
  const cells=new Map(),secrets=new Set();
  const scrub=s=>{for(const secret of secrets)s=s.replaceAll(secret,'<synthetic-credential>');return s.replace(/(PASSWORD\s+)'[^']*'/gi,"$1'<synthetic-credential>'");};
  // Each append is flushed and closed. Successful shutdown is never substituted
  // for the independent post-lifecycle retention check.
  const journal=(kind,data={})=>appendFileSync(join(root,'controller.jsonl'),JSON.stringify({time:new Date().toISOString(),kind,...data})+'\n',{mode:0o600,flush:true});
  journal('SOURCE_TRUST_ESTABLISHED',trustedSource);
  const postgres=(await import(join(snapshot,'node_modules/postgres/src/index.js'))).default;
  const authority=await import(join(snapshot,'scripts/fresh-target/contract.js'));
  const sourceContract=authority.loadFreshContract();
  const connect=(cell,database='postgres')=>postgres({host:cell.audit,port:5432,database,username:'lab_fresh_admin',password:cell.password,max:1,onnotice:()=>{},connection:{application_name:'exclusive_independent_controller'}});
  async function create(){
    // Keep host-side Unix audit socket paths below Linux's sockaddr_un limit.
    // The random cell identity remains independent of its owned directory.
    const id=randomUUID().replaceAll('-',''),dir=mkdtempSync(join(root,'c-'));chmodSync(dir,0o711);
    const c={id,dir,rootfs:join(dir,'rootfs'),control:join(dir,'control'),data:join(dir,'data'),audit:join(dir,'audit'),bootstrap:join(dir,'bootstrap'),node,snapshot,supervisor:cellSupervisor.toString(),jobs:new Map(),observations:[]};
    for(const path of [c.rootfs,c.control,c.data,c.audit,c.bootstrap])mkdirSync(path);
    for(const path of [c.data,c.audit]){chownSync(path,1001,1001);chmodSync(path,path===c.data?0o700:0o711);}
    for(const path of ['source','control','pgdata','audit','tools','bootstrap','proc','dev','work','tmp','etc'])mkdirSync(join(c.rootfs,path),{recursive:true});
    for(const n of ['node'])writeFileSync(join(c.rootfs,'tools',n),'');
    for(const n of ['null','zero','random','urandom'])writeFileSync(join(c.rootfs,'dev',n),'');
    chmodSync(join(c.rootfs,'work'),0o777);chmodSync(join(c.rootfs,'tmp'),0o1777);
    writeFileSync(join(c.rootfs,'etc/passwd'),'root:x:0:0:root:/:/bin/false\nlumi_writer:x:1000:1000:writer:/work:/bin/false\nlumi_pg:x:1001:1001:postgres:/pgdata:/bin/false\n');
    writeFileSync(join(c.rootfs,'etc/group'),'root:x:0:\nlumi_writer:x:1000:\nlumi_pg:x:1001:\n');
    writeFileSync(join(c.rootfs,'etc/hosts'),'127.0.0.1 localhost\n::1 localhost\n');
    c.password=randomBytes(32).toString('hex');secrets.add(c.password);writeFileSync(join(c.bootstrap,'password'),c.password+'\n',{mode:0o440});chownSync(join(c.bootstrap,'password'),0,1001);
    const script=`(${namespaceSetup.toString()})(${JSON.stringify(c, (k,v)=>['jobs','observations','password'].includes(k)?undefined:v)})`;
    c.child=spawn('/usr/bin/unshare',['--mount','--net','--pid','--fork','--kill-child=KILL',process.execPath,'--input-type=module','-e',script],{env:{PATH:'/usr/sbin:/usr/bin:/bin',HOME:'/root',LANG:'C.UTF-8'},stdio:['pipe','pipe','pipe'],detached:true});
    let pending='',err='';c.child.stderr.on('data',b=>{err+=scrub(b.toString());});
    const ready=new Promise((resolve,reject)=>{c.resolveReady=resolve;c.rejectReady=reject;});
    c.child.stdout.on('data',b=>{pending+=b;let at;while((at=pending.indexOf('\n'))>=0){const line=pending.slice(0,at);pending=pending.slice(at+1);let message;try{message=JSON.parse(line);}catch{c.rejectReady(Error('CELL_PROTOCOL_FAILED'));continue;}
      journal(message.kind,{cell:id,id:message.id,code:message.code,signal:message.signal});
      if(message.kind==='PG_LOG')appendFileSync(join(c.data,'postgres.log'),scrub(message.data),{mode:0o600,flush:true});
      else if(message.kind==='CELL_BOOTED')c.resolveReady(message);
      else if(message.kind==='CELL_ERROR'||message.kind==='CELL_FATAL'){const job=c.jobs.get(message.id);if(job)job.reject(Error(scrub(message.error)));else c.rejectReady(Error(scrub(message.error)));}
      else c.onMessage?.(message);
    }});
    c.closed=new Promise(resolve=>c.child.once('close',(code,signal)=>{c.exit={code,signal,stderr:err};c.rejectReady(Error('CELL_EXIT:'+err));resolve(c.exit);}));
    c.child.once('error',e=>c.rejectReady(e));
    cells.set(id,c);journal('CELL_STORAGE',{cell:id,directory:dir,data:c.data,audit:c.audit});
    c.child.stdin.write(JSON.stringify({writerFilter:WRITER_FILTER})+'\n');const boot=await ready;c.postgresPid=boot.postgresPid;
    const members=namespaceMembers(readlinkSync(`/proc/${c.child.pid}/ns/net`));
    // namespaceSetup must first be exec'd through unshare; see launch below.
    c.namespace=members[0]?.namespaces.net;
    let identity;
    for(let n=0;n<100;n++){const q=connect(c);try{[identity]=await q`SELECT system_identifier::text AS system,current_setting('server_version_num')::int/10000 AS major FROM pg_control_system()`;break;}catch{await new Promise(r=>setTimeout(r,20));}finally{await q.end({timeout:1});}}
    if(!identity||identity.major!==17)throw Error('PG17_STARTUP_UNQUALIFIED');
    c.system=identity.system;if(readFileSync(join(c.data,'global/pg_control')).readBigUInt64LE(0).toString()!==c.system)throw Error('PHYSICAL_IDENTITY_UNQUALIFIED');
    journal('CELL_IDENTITY',{cell:id,system:c.system,namespace:c.namespace});
    return {id,port:5432,system:c.system,audit:c.audit,adminPassword:c.password,data:c.data};
  }
  function kernelWriter(c,pid){
    const members=namespaceMembers(c.namespace),app=members.find(p=>p.nspid.at(-1)===pid);
    if(!app||app.uid!=='1000'||app.capEff!=='0000000000000000'||app.capBnd!=='0000000000000000'||app.noNewPrivs!=='1'||app.seccomp!=='2'
      ||app.namespaces.net!==c.namespace||app.namespaces.mnt===ns('self').mnt||app.namespaces.pid===ns('self').pid)throw Error('WRITER_KERNEL_STATE_UNQUALIFIED');
    const rootPath=realpathSync(`/proc/${app.pid}/root`);
    if(rootPath!==c.rootfs)throw Error('WRITER_ROOT_UNQUALIFIED');
    const fds=readdirSync(`/proc/${app.pid}/fd`).flatMap(fd=>{try{return[{fd:Number(fd),link:readlinkSync(`/proc/${app.pid}/fd/${fd}`)}];}catch(e){if(e.code==='ENOENT')return[];throw e;}});
    if(fds.some(fd=>/^\//.test(fd.link)&&!fd.link.startsWith(c.rootfs+'/')&&!fd.link.startsWith(c.snapshot+'/')&&fd.link!==c.node&&fd.link!=='/dev/null'))throw Error('WRITER_FD_UNQUALIFIED');
    return {...app,rootVerified:true,fds};
  }
  async function run(c,request){
    return withExclusiveCellReservation(c,()=>runReserved(c,request));
  }
  async function runReserved(c,request){
    const input=request.input;
    const rejected=reason=>({result:{status:'REFUSED',reason,phase:'CONTROLLER',scope:'FRESH_TARGET_PROVISIONING_ONLY',runtimeAdmission:'NOT_WIRED'},checkpoint:false,processes:[],writersAbsent:true});
    let target;
    try{
      if(!authority.plain(input,['approval','approvalSha256','url','caPem']))return rejected('INPUT_UNQUALIFIED');
      target=authority.validateApproval(input.approval,input.approvalSha256,input.url,sourceContract.artifactSha256);
    }catch(e){return rejected(/^(APPROVAL|TARGET)_UNQUALIFIED$/.test(e.message)?e.message:'INPUT_UNQUALIFIED');}
    if(target.systemIdentifier!==c.system)return rejected('IDENTITY_MISMATCH');
    // Maintenance-only connection: it is closed before any operator or
    // migration process is launched, and never occupies the application DB.
    const maintenance=connect(c);
    try{
      const [identity]=await maintenance`SELECT system_identifier::text AS system,
        (SELECT oid::int FROM pg_database WHERE datname=${target.database}) AS oid,
        (SELECT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls
          FROM pg_roles WHERE rolname=${target.login}) AS scoped FROM pg_control_system()`;
      if(identity.system!==target.systemIdentifier||identity.oid!==target.databaseOid||identity.scoped!==true)return rejected('IDENTITY_MISMATCH');
    }finally{await maintenance.end();}
    secrets.add(decodeURIComponent(new URL(input.url).password));
    const id=randomUUID().replaceAll('-',''),job={id,output:'',stderr:'',observations:[],checkpoint:false};
    let deadline,observer;
    c.jobs.set(id,job);
    const completed=new Promise((resolve,reject)=>{job.resolve=resolve;job.reject=reject;});
    const stopWriter=()=>c.child.stdin.write(JSON.stringify({method:'cancel',id})+'\n');
    c.onMessage=async message=>{
      if(message.id!==id)return;
      try{
        if(message.kind==='JOB_STARTED'){
          job.pid=message.pid;
          const writer=kernelWriter(c,job.pid),pg=namespaceMembers(c.namespace).find(p=>p.nspid.at(-1)===c.postgresPid);
          journal('PG_KERNEL_IDENTITY',{cell:c.id,job:id,process:pg});
          const actual=pg&&statSync(`/proc/${pg.pid}/exe`),expected=statSync('/usr/lib/postgresql/17/bin/postgres');
          if(!pg||pg.uid!=='1001'||actual.ino!==expected.ino||actual.dev!==expected.dev||pg.capEff!=='0000000000000000'||pg.noNewPrivs!=='1')throw Error('PG_KERNEL_STATE_UNQUALIFIED');
          const t=input.approval.target,q=request.qualification;
          if(!plain(q)||JSON.stringify(q.target)!==JSON.stringify(t))throw Error('QUALIFICATION_TARGET_UNQUALIFIED');
          const dir=join(c.control,'jobs',id);mkdirSync(dir,{recursive:true});
          const lease={version:1,scope:'OWNED_SYNTHETIC_LINUX_CELL',cellId:c.id,expiresAt:input.approval.expiresAt,
            target:t,appPid:job.pid,writerUid:1000,namespaces:writer.namespaces,postgresPid:pg.nspid.at(-1),postgresStart:pg.start,seccompSha256:sha(WRITER_FILTER)};
          const leaseBytes=JSON.stringify(lease);writeFileSync(join(dir,'lease.json'),leaseBytes,{mode:0o444,flag:'wx',flush:true});
          job.leaseFile=join(dir,'lease.json');job.leaseSha256=sha(leaseBytes);job.expiresAt=lease.expiresAt;
          const sealed={...q,kernelLeaseFile:'/control/jobs/'+id+'/lease.json',kernelLeaseSha256:sha(leaseBytes)};
          const qBytes=JSON.stringify(sealed);writeFileSync(join(dir,'qualification.json'),qBytes,{mode:0o444,flag:'wx',flush:true});
          input.approval.exclusiveTarget={version:1,scope:'OWNED_SYNTHETIC_PG17_ONLY',qualificationFile:'/control/jobs/'+id+'/qualification.json',qualificationSha256:sha(qBytes)};
          input.approvalSha256=sha(JSON.stringify(input.approval));
          job.observations.push(writer);journal('WRITER_KERNEL_IDENTITY',{cell:c.id,job:id,writer});
          c.child.stdin.write(JSON.stringify({method:'input',id,payload:{input,inspect:!!request.inspect,probe:request.probe}})+'\n');
          observer=setInterval(()=>{try{
            if(Date.now()>=job.expiresAt||sha(readFileSync(job.leaseFile))!==job.leaseSha256)throw Error('APPROVAL_OR_POLICY_LOST');
            const owned=namespaceMembers(c.namespace).filter(p=>p.uid==='1000');
            for(const p of owned){if(p.capEff!=='0000000000000000'||p.capBnd!=='0000000000000000'||p.noNewPrivs!=='1'||p.seccomp!=='2')throw Error('WRITER_ENFORCEMENT_LOST');
              if(!job.observations.some(o=>o.pid===p.pid&&o.start===p.start)){job.observations.push(p);journal('WRITER_DESCENDANT',{cell:c.id,job:id,process:p});}}
          }catch(e){job.uncertain=e.message;stopWriter();}},10);
        }else if(message.kind==='JOB_STDOUT')job.output+=scrub(message.data);
        else if(message.kind==='JOB_STDERR')job.stderr+=scrub(message.data);
        else if(message.kind==='JOB_CHECKPOINT'){
          kernelWriter(c,job.pid);job.checkpoint=true;journal('WRITER_PREFLIGHT_CHECKPOINT',{cell:c.id,job:id});
          if(!request.hold)c.child.stdin.write(JSON.stringify({method:'continue',id})+'\n');
        }else if(message.kind==='JOB_CLOSED'){
          clearInterval(observer);clearTimeout(deadline);
          let remaining=namespaceMembers(c.namespace).filter(p=>p.uid==='1000');
          if(remaining.length){
            job.uncertain='WRITER_TERMINATION_UNCERTAIN';stopWriter();
            for(let attempt=0;attempt<100&&remaining.length;attempt++){
              await new Promise(resolve=>setTimeout(resolve,5));remaining=namespaceMembers(c.namespace).filter(p=>p.uid==='1000');
            }
          }
          if(remaining.length){c.quarantined='WRITER_TERMINATION_UNCERTAIN';job.reject(Error(c.quarantined));return;}
          if(job.uncertain){c.jobs.delete(id);c.quarantined=job.uncertain;job.reject(Error(job.uncertain));return;}
          const match=job.output.match(/EXCLUSIVE_APPLICATION_RESULT (.+)/);
          const value={result:match?JSON.parse(match[1]):null,code:message.code,signal:message.signal,output:job.output,stderr:job.stderr,
            checkpoint:job.checkpoint,processes:job.observations,writersAbsent:true};
          c.jobs.delete(id);journal('WRITER_COMPLETED',{cell:c.id,job:id,code:message.code,signal:message.signal,writersAbsent:true});job.resolve(value);
        }
      }catch(e){job.uncertain=e.message;clearInterval(observer);stopWriter();}
    };
    // Controller deadline cannot extend approval. A failed/uncertain job is
    // quarantined; the cell is never automatically replayed or reused.
    deadline=setTimeout(()=>{job.uncertain='APPROVAL_OR_WRITER_DEADLINE';stopWriter();},Math.max(1,Math.min(125000,input.approval.expiresAt-Date.now())));
    c.child.stdin.write(JSON.stringify({method:'run',id})+'\n');
    return completed;
  }
  async function stop(c){
    assertExclusiveCellStopReady(c);
    c.child.stdin.write(JSON.stringify({method:'stop'})+'\n');await c.closed;
    if(c.exit.code!==0||c.exit.signal||namespaceMembers(c.namespace).length)throw Error('CELL_TEARDOWN_UNQUALIFIED');
    const state={id:c.id,system:c.system,exit:c.exit,namespaceAbsent:true,dataRetained:true};journal('CELL_TEARDOWN',state);return state;
  }
  const socket=join(root,'controller.sock');
  const server=net.createServer(front=>{let pending='';front.on('data',b=>{pending+=b;if(pending.length>4*1024*1024){front.destroy();return;}const at=pending.indexOf('\n');if(at<0)return;const line=pending.slice(0,at);pending='';
    (async()=>{const r=JSON.parse(line);if(!plain(r))throw Error('REQUEST_UNQUALIFIED');
      if(r.method==='create')return create();
      const c=cells.get(r.cellId);if(!c)throw Error('CELL_UNOWNED');
      if(r.method==='stop')return stop(c);
      if(r.method==='run')return run(c,r);
      if(r.method==='cancel'){
        // The test owner may end only this owned cell's writer lifetime. A
        // timeout cannot fall through to PostgreSQL teardown with work alive.
        for(const job of c.jobs.values())job.uncertain='OWNED_TEARDOWN_CANCELLED';
        if(c.jobs.size||namespaceMembers(c.namespace).some(p=>p.uid==='1000')){
          c.child.stdin.write(JSON.stringify({method:'cancel',id:[...c.jobs.keys()][0]})+'\n');
          for(let n=0;n<200&&(c.jobs.size||namespaceMembers(c.namespace).some(p=>p.uid==='1000'));n++)await new Promise(resolve=>setTimeout(resolve,5));
        }
        if(c.jobs.size||namespaceMembers(c.namespace).some(p=>p.uid==='1000'))throw Error('WRITER_TERMINATION_UNCERTAIN');
        return {cell:c.id,writersAbsent:true};
      }
      if(r.method==='release'){
        const job=[...c.jobs.values()].find(j=>j.checkpoint);if(!job)throw Error('NO_HELD_CHECKPOINT');
        kernelWriter(c,job.pid);c.child.stdin.write(JSON.stringify({method:'continue',id:job.id})+'\n');return {released:true};
      }
      if(r.method==='freeze'){
        const owned=namespaceMembers(c.namespace).filter(p=>p.uid==='1000');
        if(!c.jobs.size||!owned.length)throw Error('NO_OWNED_WRITER');
        for(const p of owned)process.kill(p.pid,'SIGSTOP');
        journal('OWNED_WRITERS_FROZEN',{cell:c.id,processes:owned});return {processes:owned};
      }
      if(r.method==='tls'){
        if([...c.jobs.values()].some(j=>!j.checkpoint)||typeof r.cert!=='string'||typeof r.key!=='string')throw Error('TLS_CONFIGURATION_UNQUALIFIED');
        for(const [name,bytes] of [['server.crt',r.cert],['server.key',r.key]]){const path=join(c.data,name);writeFileSync(path,bytes,{mode:0o600});chownSync(path,1001,1001);}
        appendFileSync(join(c.data,'postgresql.conf'),"\nssl=on\nssl_cert_file='server.crt'\nssl_key_file='server.key'\nlog_connections=on\nlog_disconnections=on\nlog_statement='ddl'\n");
        const q=connect(c);try{await q`SELECT pg_reload_conf()`;}finally{await q.end();}return {configured:true};
      }
      if(r.method==='hba'){
        if([...c.jobs.values()].some(j=>!j.checkpoint)||typeof r.allow!=='boolean')throw Error('HBA_CONFIGURATION_UNQUALIFIED');
        const path=join(c.data,'pg_hba.conf'),policy=`local all all scram-sha-256\nhostssl all lumi_backend_migrator 127.0.0.1/32 ${r.allow?'scram-sha-256':'reject'}\nhost all lumi_backend_migrator 0.0.0.0/0 reject\nhost all all 127.0.0.1/32 scram-sha-256\n`;
        writeFileSync(path,policy);chownSync(path,1001,1001);
        const q=connect(c);try{await q`SELECT pg_reload_conf()`;}finally{await q.end();}return {policy};
      }
      if(r.method==='log')return {log:scrub(readFileSync(join(c.data,'postgres.log'),'utf8'))};
      if(r.method==='identity')return {id:c.id,system:c.system,namespace:c.namespace,members:namespaceMembers(c.namespace),jobs:[...c.jobs.values()].map(j=>({id:j.id,pid:j.pid,checkpoint:j.checkpoint}))};
      throw Error('METHOD_UNQUALIFIED');
    })().then(value=>front.end(JSON.stringify({ok:true,value})+'\n'),error=>{journal('REQUEST_REFUSED',{error:scrub(error.message)});front.end(JSON.stringify({ok:false,error:scrub(error.message)})+'\n');});
  });front.on('error',()=>{});});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve);});chmodSync(socket,0o600);chownSync(socket,1000,1000);
  writeFileSync(infoFile,JSON.stringify({scope:'OWNED_SYNTHETIC_LINUX_CELL',socket,root,pid:process.pid,sourceRoot,storage:storageRecord,trustedSource,controllerSha256:sha(readFileSync(fileURLToPath(import.meta.url)))},null,2),{mode:0o444,flag:'wx',flush:true});
  process.stdout.write('EXCLUSIVE_CONTROLLER_READY\n');
  process.on('SIGTERM',async()=>{for(const c of cells.values()){try{if(!c.exit)await stop(c);}catch(e){journal('QUARANTINED',{cell:c.id,error:scrub(e.message)});process.exitCode=1;}}server.close();});
}

export function exclusiveControllerRequest(socket, request) {
  return new Promise((resolve,reject)=>{const connection=net.connect(socket);let text='';connection.on('connect',()=>connection.write(JSON.stringify(request)+'\n'));
    connection.on('data',b=>text+=b);connection.once('error',reject);connection.once('end',()=>{try{const r=JSON.parse(text);r.ok?resolve(r.value):reject(Error(r.error));}catch(e){reject(e);}});});
}

if(process.argv[1]===fileURLToPath(import.meta.url)&&process.argv[2]==='--serve'){
  serveExclusiveController(process.argv[3],process.argv[4]).catch(e=>{console.error(e.message);process.exitCode=1;});
}

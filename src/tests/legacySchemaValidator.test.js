import { describe, it, expect } from 'vitest';
import { mkdtempSync,readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const load = () => import('../../scripts/legacy-schema/verify.js');
describe('03B-1A explicit diagnostic fails closed before I/O', () => {
  it('requires a complete externally supplied target', async () => {
    const { verifyLegacySchema } = await load();
    let opened = false;
    const result = await verifyLegacySchema({ open: () => { opened = true; } });
    expect(result.status).toBe('UNKNOWN');
    expect(opened).toBe(false);
  });
  it('does not substitute ambient DATABASE_URL or return secrets', async () => {
    const { verifyLegacySchema } = await load();
    const result = await verifyLegacySchema({ url: 'do-not-print-this-secret' });
    expect(result.status).toBe('UNKNOWN');
    expect(JSON.stringify(result)).not.toContain('do-not-print');
  });
  it('rejects a missing manifest override before opening a connection', async () => {
    const { verifyLegacySchema } = await load();
    let opened = false;
    const result = await verifyLegacySchema({ manifestPath: '/missing/contract.json', open: () => { opened = true; } });
    expect(result.status).toBe('UNKNOWN');
    expect(opened).toBe(false);
  });
  const bindings={owner:'fixture_owner',runtime:'fixture_runtime',auditor:'fixture_auditor'};
  const target={hostname:'127.0.0.1',port:55438,database:'fixture',login:bindings.auditor,
    serverAddress:'127.0.0.1',serverPort:55438,versionMajor:17,tls:'disabled-loopback'};
  const url='postgresql://fixture_auditor@127.0.0.1:55438/fixture';
  async function forgedContract() {
    const contract=await import('../../scripts/legacy-schema/contract.js');
    const manifest=JSON.parse(readFileSync(contract.MANIFEST,'utf8'));
    expect(manifest.catalog.columns).toHaveLength(43);
    manifest.catalog.columns.pop();
    expect(Object.keys(manifest.catalog)).toHaveLength(21);
    const dir=mkdtempSync(join(tmpdir(),'lumi-p1-contract-'));
    const manifestPath=join(dir,'forged.json');
    writeFileSync(manifestPath,JSON.stringify(manifest));
    return {contract,dir,manifestPath};
  }
  it('rejects a complete forged contract with one expected column removed',async()=>{
    const {contract,manifestPath}=await forgedContract();
    expect(()=>contract.loadContract({bindings,manifestPath,root:contract.ROOT})).toThrow();
  });
  it('rejects changed bundled manifest bytes even without a path override',async()=>{
    const {dir,manifestPath}=await forgedContract();
    // Isolated module copy exercises the fixed-path hash seal; repository authority is untouched.
    const copy=join(dir,'scripts','legacy-schema');mkdirSync(copy,{recursive:true});
    writeFileSync(join(copy,'contract.mjs'),readFileSync(new URL('../../scripts/legacy-schema/contract.js',import.meta.url),'utf8'));
    writeFileSync(join(copy,'manifest.v1.json'),readFileSync(manifestPath));
    const isolated=await import(/* @vite-ignore */ pathToFileURL(join(copy,'contract.mjs')).href);
    expect(()=>isolated.loadContract({bindings})).toThrow('Unapproved manifest');
  });
  it.each(['manifestPath','root'])('normal verification rejects a %s override before opening a pool',async(key)=>{
    const {contract,manifestPath}=await forgedContract();
    const {verifyLegacySchema}=await load();let opened=false;
    const result=await verifyLegacySchema({url,target,bindings,[key]:key==='root'?contract.ROOT:manifestPath,
      open:()=>{opened=true;throw new Error('Connection must not be attempted');}});
    expect(opened).toBe(false);expect(result.status).toBe('UNKNOWN');
  });
  it.each(['manifestPath','root'])('actual CLI rejects target JSON %s before any socket connection',async(key)=>{
    const {contract,dir,manifestPath}=await forgedContract();
    const config=join(dir,'target.json'),guard=join(dir,'socket-guard.cjs'),trace=join(dir,'connections.jsonl');
    writeFileSync(trace,'');
    writeFileSync(config,JSON.stringify({target,bindings,[key]:key==='root'?contract.ROOT.href:manifestPath}));
    // The child has no ambient credentials or dotenv. Block before calling the real socket method.
    writeFileSync(guard,"require('node:net').Socket.prototype.connect=function(){require('node:fs').appendFileSync(process.env.LUMI_P1_SOCKET_TRACE,'CONNECTION_ATTEMPT\\n');throw new Error('P1_CONNECTION_BLOCKED');};");
    const run=spawnSync(process.execPath,['--require',guard,'scripts/verify-legacy-schema.js'],{encoding:'utf8',env:{
      SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,LEGACY_SCHEMA_AUDIT_TARGET_FILE:config,
      LEGACY_SCHEMA_AUDIT_URL:url,LUMI_P1_SOCKET_TRACE:trace}});
    expect(run.error).toBeUndefined();expect(run.status).toBe(1);
    expect(readFileSync(trace,'utf8')).toBe('');
    expect(JSON.parse(run.stdout)).toMatchObject({status:'UNKNOWN',reasons:['CONTRACT_OR_SOURCE_UNQUALIFIED']});
  });
  it('does not leak connection error messages and always closes the pool',async()=>{
    const {verifyLegacySchema}=await load();let closed=false;
    const result=await verifyLegacySchema({url,target,bindings,open:()=>({
      begin:async()=>{throw Object.assign(new Error('private-password-and-host'),{code:'42501'});},end:async()=>{closed=true;}})});
    expect(result).toMatchObject({status:'FAILED',sqlState:'42501'});expect(closed).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private-password');
  });
  it('rejects a missing source-root override without opening a pool',async()=>{
    const {verifyLegacySchema}=await load();let opened=false;
    const result=await verifyLegacySchema({url,target,bindings,root:new URL('file:///definitely-missing/'),open:()=>{opened=true;}});
    expect(result.status).toBe('UNKNOWN');expect(opened).toBe(false);
  });
  it('rejects an empty or incomplete manifest without opening a pool',async()=>{
    const {verifyLegacySchema}=await load();const {MANIFEST}=await import('../../scripts/legacy-schema/contract.js');
    const manifest=JSON.parse(readFileSync(MANIFEST,'utf8'));manifest.catalog.columns=[];
    const path=join(mkdtempSync(join(tmpdir(),'lumi-legacy-manifest-')),'contract.json');writeFileSync(path,JSON.stringify(manifest));
    let opened=false;const result=await verifyLegacySchema({url,target,bindings,manifestPath:path,open:()=>{opened=true;}});
    expect(result.status).toBe('UNKNOWN');expect(opened).toBe(false);
  });
  it('rejects URL option overrides and unencrypted non-loopback targets before I/O',async()=>{
    const {verifyLegacySchema}=await load();let opened=false;
    for(const options of [{url:url+'?options=unsafe',target},{url:'postgresql://fixture_auditor@remote.invalid:55438/fixture',target:{...target,hostname:'remote.invalid'}}]){
      expect((await verifyLegacySchema({...options,bindings,open:()=>{opened=true;}})).status).toBe('UNKNOWN');
    }expect(opened).toBe(false);
  });
  it('the actual CLI refuses absent explicit config without ambient database fallback',()=>{
    const run=spawnSync(process.execPath,['scripts/verify-legacy-schema.js'],{encoding:'utf8',env:{
      SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,DATABASE_URL:'never-read-this-ambient-secret'}});
    expect(run.status).toBe(1);expect(JSON.parse(run.stdout).status).toBe('UNKNOWN');
    expect(run.stdout+run.stderr).not.toContain('ambient-secret');
  });
});

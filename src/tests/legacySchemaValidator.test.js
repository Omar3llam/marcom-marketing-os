import { describe, it, expect } from 'vitest';
import { mkdtempSync,readFileSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

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
  it('rejects a missing manifest before opening a connection', async () => {
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
  it('does not leak connection error messages and always closes the pool',async()=>{
    const {verifyLegacySchema}=await load();let closed=false;
    const result=await verifyLegacySchema({url,target,bindings,open:()=>({
      begin:async()=>{throw Object.assign(new Error('private-password-and-host'),{code:'42501'});},end:async()=>{closed=true;}})});
    expect(result).toMatchObject({status:'FAILED',sqlState:'42501'});expect(closed).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private-password');
  });
  it('rejects missing source without opening a pool',async()=>{
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

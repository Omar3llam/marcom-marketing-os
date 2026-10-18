import postgres from 'postgres';
import { collectStructure } from './catalog.js';
import { collectAuthority } from './authority.js';
import { loadContract, canonical } from './contract.js';

const scope='LEGACY_NATIVE_DIAGNOSTIC_ONLY';
function validTarget(url, target, bindings) {
  try {
    const u=new URL(url);
    return ['postgres:','postgresql:'].includes(u.protocol) && target?.versionMajor===17
      && ['hostname','database','login','serverAddress'].every(k=>typeof target[k]==='string'&&target[k].length>0)
      && Number.isInteger(target.port)&&target.port>0&&target.port<=65535
      && Number.isInteger(target.serverPort)&&target.serverPort>0&&target.serverPort<=65535
      && u.hostname===target.hostname&&Number(u.port||5432)===target.port
      && decodeURIComponent(u.pathname.slice(1))===target.database&&decodeURIComponent(u.username)===target.login
      && target.login===bindings?.auditor && !u.search && !u.hash
      && (target.tls==='verify-full'||(target.tls==='disabled-loopback'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)));
  }catch{return false;}
}
export async function verifyLegacySchema(options = {}) {
  const {url,target,bindings,open=postgres}=options;
  let manifest;
  try {manifest=loadContract(options);}catch{return {status:'UNKNOWN',scope,reasons:['CONTRACT_OR_SOURCE_UNQUALIFIED']};}
  const base={scope,manifestVersion:manifest.version,sourceCommit:manifest.sourceCommit,manifestSha256:manifest.manifestSha256};
  if(!validTarget(url,target,bindings))return {...base,status:'UNKNOWN',reasons:['TARGET_UNQUALIFIED']};
  let sql;
  try {
    sql=open(url,{max:1,connect_timeout:5,idle_timeout:2,onnotice:()=>{},ssl:target.tls==='verify-full'?{rejectUnauthorized:true}:false,
      connection:{application_name:'lumi-legacy-audit',default_transaction_read_only:'on'}});
    return await sql.begin('isolation level repeatable read read only',async tx=>{
      await tx`SET LOCAL statement_timeout='5s'`;
      await tx`SET LOCAL lock_timeout='1s'`;
      await tx`SET LOCAL search_path=pg_catalog,pg_temp`;
      const [identity]=await tx`SELECT current_database() AS database,current_user AS login,session_user AS session_login,
        host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('server_version_num')::int/10000 AS major,
        current_setting('transaction_read_only') AS read_only`;
      if(identity.database!==target.database||identity.login!==target.login||identity.session_login!==target.login
        ||identity.address!==target.serverAddress||identity.port!==target.serverPort||identity.major!==target.versionMajor||identity.read_only!=='on')
        return {...base,status:'INCOMPATIBLE',reasons:['TARGET_IDENTITY_MISMATCH']};
      const catalog={...await collectStructure(tx),...await collectAuthority(tx,bindings)};
      const mismatch=Object.keys(manifest.catalog).filter(k=>JSON.stringify(canonical(catalog[k]))!==JSON.stringify(canonical(manifest.catalog[k])));
      // No timestamps/log messages/customer data are read or emitted.
      const history=await tx`SELECT migration_name,checksum,finished_at IS NOT NULL AS finished,
        rolled_back_at IS NOT NULL AS rolled_back,applied_steps_count FROM public._prisma_migrations`;
      if(history.length!==manifest.source.migrations.length||manifest.source.migrations.some(m=>{
        const receipts=history.filter(r=>r.migration_name===m.name);
        return receipts.length!==1||!receipts[0].finished||receipts[0].rolled_back||receipts[0].applied_steps_count!==1||receipts[0].checksum!==m.checksum;
      }))mismatch.push('migrationHistory');
      return {...base,status:mismatch.length?'INCOMPATIBLE':'COMPATIBLE',reasons:mismatch,
        inventory:Object.fromEntries(Object.entries(catalog).map(([k,v])=>[k,v.length])),
        limitation:'No canonical-native, startup, credential-data, production or release qualification'};
    });
  }catch(error){return {...base,status:'FAILED',reasons:['CATALOG_OR_CONNECTION_FAILED'],
    sqlState:/^[A-Z0-9]{5}$/.test(error?.code||'')?error.code:undefined};}
  finally{if(typeof sql?.end==='function')await sql.end({timeout:2}).catch(()=>{});}
}

// Explicit diagnostic only. No dotenv or ambient DATABASE_URL fallback.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { verifyLegacySchema } from './legacy-schema/verify.js';
export async function main(env=process.env) {
  let result;
  try {
    const config=JSON.parse(readFileSync(env.LEGACY_SCHEMA_AUDIT_TARGET_FILE,'utf8'));
    result=await verifyLegacySchema({...config,url:env.LEGACY_SCHEMA_AUDIT_URL});
  }catch{result={status:'UNKNOWN',scope:'LEGACY_NATIVE_DIAGNOSTIC_ONLY',reasons:['EXPLICIT_TARGET_FILE_REQUIRED']};}
  process.stdout.write(JSON.stringify(result)+'\n');
  return result.status==='COMPATIBLE'?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=await main();

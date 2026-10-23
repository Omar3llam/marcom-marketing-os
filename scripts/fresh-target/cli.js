import { readFileSync, lstatSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { provisionFreshTarget, inspectFreshTarget } from './provision.js';

export async function main(env = process.env) {
  let result;
  try {
    if (!env.FRESH_TARGET_APPROVAL_FILE || !env.FRESH_TARGET_APPROVAL_SHA256 || !env.FRESH_TARGET_URL) throw Error();
    const stat = lstatSync(env.FRESH_TARGET_APPROVAL_FILE);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw Error();
    const approval = JSON.parse(readFileSync(env.FRESH_TARGET_APPROVAL_FILE, 'utf8'));
    if (!['provision', 'inspect'].includes(env.FRESH_TARGET_ACTION || 'provision')) throw Error();
    result = await (env.FRESH_TARGET_ACTION === 'inspect' ? inspectFreshTarget : provisionFreshTarget)({ approval, approvalSha256: env.FRESH_TARGET_APPROVAL_SHA256, url: env.FRESH_TARGET_URL,
      caPem: env.FRESH_TARGET_CA_FILE ? readFileSync(env.FRESH_TARGET_CA_FILE, 'utf8') : undefined });
  } catch { result = { status: 'REFUSED', reason: 'EXPLICIT_OPERATOR_INPUT_REQUIRED', phase: 'INPUT', scope: 'FRESH_TARGET_PROVISIONING_ONLY', runtimeAdmission: 'NOT_WIRED' }; }
  process.stdout.write(JSON.stringify(result) + '\n');
  return ['PROVISIONED_MATCH', 'OBSERVED_MATCH'].includes(result.status) ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();

import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const ROOT = new URL('../../', import.meta.url);
export const MANIFEST = new URL('./manifest.v2.json', import.meta.url);
export const SOURCE_FILES = ['scripts/migrate.js', 'src/models/chatSession.js', 'src/models/userContext.js',
  'src/models/project.js', 'src/models/credential.js', 'prisma/schema.prisma'];
export const digest = (s) => createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
// Reviewed manifest bytes, normalized only for Git's LF/CRLF checkout behavior.
const APPROVED_MANIFEST_SHA256 = 'dc4687bf45b8965de94acd93975218504c3294b9b3694ba0bd1c8a9a1faf3da4';
export function sourceInventory(root = ROOT) {
  const sources = Object.fromEntries(SOURCE_FILES.map(p=>[p,digest(readFileSync(new URL(p,root),'utf8'))]));
  const dir = new URL('prisma/migrations/',root);
  const migrations = readdirSync(dir,{withFileTypes:true}).filter(x=>x.isDirectory()&&/^\d{14}_/.test(x.name))
    .map(x=>({name:x.name,checksum:digest(readFileSync(new URL(x.name+'/migration.sql',dir),'utf8'))})).sort((a,b)=>a.name.localeCompare(b.name));
  if (!migrations.length) throw new Error('Missing migration source');
  return {sources,migrations};
}
export function canonical(value) {
  if(Array.isArray(value))return value.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
export function bind(value, bindings) {
  if(Array.isArray(value))return value.map(x=>bind(x,bindings));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,bind(v,bindings)]));
  return typeof value==='string'?value.replace(/\$\{(owner|runtime|auditor)\}/g,(_,key)=>bindings[key]):value;
}
export function loadContract(options = {}) {
  if(Object.hasOwn(options,'manifestPath')||Object.hasOwn(options,'root'))throw new Error('Untrusted contract override');
  const {bindings}=options;
  // Resolve authority from this module, never operator input or mutable exported URLs.
  const text=readFileSync(new URL('./manifest.v2.json',import.meta.url),'utf8');
  if(digest(text)!==APPROVED_MANIFEST_SHA256)throw new Error('Unapproved manifest');
  const manifest = JSON.parse(text);
  if(manifest.version!=='legacy-native-v2' || manifest.sourceCommit!=='6ee98edda008fd8370e6d871b23e03922006577d'
    || !bindings || ['owner','runtime','auditor'].some(k=>!/^[a-z_][a-z0-9_]{0,62}$/.test(bindings[k]||''))
    || new Set(Object.values(bindings)).size!==3) throw new Error('Unqualified contract');
  const actual=sourceInventory(new URL('../../',import.meta.url));
  if(JSON.stringify(canonical(actual))!==JSON.stringify(canonical(manifest.source)))throw new Error('Source drift');
  const categories=['tables','columns','constraints','indexes','triggers','functions','extensions','sequences','policies','prerequisites','prerequisiteKeys',
    'schemas','database','acl','columnAcl','defaultAcl','roleFacts','memberships','roleSettings','effective','capabilities'];
  if(JSON.stringify(Object.keys(manifest.catalog).sort())!==JSON.stringify(categories.sort())
    || ['tables','columns','constraints','indexes','triggers','functions','extensions','prerequisites','prerequisiteKeys','schemas','database','acl','roleFacts','effective','capabilities']
      .some(k=>!Array.isArray(manifest.catalog[k])||!manifest.catalog[k].length))throw new Error('Incomplete manifest');
  return {...manifest,manifestSha256:digest(text),catalog:bind(manifest.catalog,bindings)};
}

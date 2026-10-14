// Controlled real child processes for the smoke CLI regression. No network/DB.
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const spawn = cp.spawn;
const mode = process.env.SMOKE_FIXTURE_MODE;
cp.spawn = (exe, args, options) => {
  const kind = args[0].includes('workers/') ? 'worker' : 'api';
  const marker = kind === 'worker'
    ? '[worker] all workers online\n[worker] campaign sync scheduled'
    : 'MARCOM v4 online';
  const code = `
    console.log(${JSON.stringify(marker)});
    setInterval(() => {}, 1000);
    ${mode === 'worker-signal' && kind === 'worker' ? '' : `process.on('SIGTERM', () => { console.log('FIXTURE SIGTERM cleanup'); process.exit(0); });`}
    ${kind === 'worker' && mode === 'worker-exit-17' ? 'setTimeout(() => process.exit(17), 150);' : ''}
    ${kind === 'worker' && mode === 'worker-exit-0' ? 'setTimeout(() => process.exit(0), 150);' : ''}
    ${kind === 'api' && mode === 'api-exit-17' ? 'setTimeout(() => process.exit(17), 150);' : ''}
  `;
  const child = spawn(exe, ['-e', code], options);
  const kill = child.kill.bind(child);
  child.kill = signal => { console.log(`FIXTURE kill ${kind}: ${signal}`); return kill(signal); };
  let output = '';
  child.stdout.on('data', bytes => output += bytes);
  child.on('close', (status, signal) => console.log(`FIXTURE closed ${kind}: code=${status} signal=${signal} cleanup=${output.includes('FIXTURE SIGTERM cleanup')}`));
  if (kind === 'worker' && mode === 'worker-signal') setTimeout(() => child.kill('SIGTERM'), 150);
  return child;
};
syncBuiltinESMExports();
globalThis.fetch = async raw => {
  if (mode === 'api-exit-17') await new Promise(done => setTimeout(done, 300));
  const path = new URL(raw).pathname;
  const status = path.startsWith('/api/__') || path.startsWith('/webhook/') ? 401
    : path.startsWith('/app/') ? 404 : 200;
  return new Response(path === '/health' ? '{"db":true}' : '{}', {status, headers: {'content-type': 'application/json'}});
};

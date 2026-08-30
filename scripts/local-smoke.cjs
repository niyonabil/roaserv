/**
 * Local smoke test: spawn the API bundle as a child process, run live HTTP
 * checks against it (login, RBAC, tenant-scoped clients), then exit.
 * Runs entirely in one foreground process — no long-lived daemon needed.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres.asurkmjggbyxcylrdvae:Roa0629605450@aws-0-eu-central-1.pooler.supabase.com:6543/postgres',
  JWT_SECRET: process.env.JWT_SECRET || 'roa_services_super_secret_change_me_8f3a2c91',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'roa_services_refresh_secret_b7e1d4a6',
  JWT_EXPIRES_IN: '900',
  JWT_REFRESH_EXPIRES_IN: '2592000',
  PORT: '4100',
};
const child = spawn(process.execPath, [path.join(__dirname, '..', 'dist', 'api-test.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let childOut = '';
child.stdout.on('data', (d) => (childOut += d));
child.stderr.on('data', (d) => (childOut += d));

const BASE = 'http://localhost:4100';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, extra = '') { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, extra); } }

(async () => {
  // wait for listen
  for (let i = 0; i < 30; i++) { if (childOut.includes('listening on 4100')) break; await sleep(500); }
  await sleep(800);

  try {
    const health = await fetch(BASE + '/health');
    check('health 200', health.status === 200);

    const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Roa0629605450' }) });
    const loginJson = await login.json();
    const tok = loginJson?.data?.accessToken;
    check('login 200 + JWT', login.status === 200 && !!tok, 'status=' + login.status);

    const noTok = await fetch(BASE + '/api/clients');
    check('no token -> 401', noTok.status === 401, 'status=' + noTok.status);

    const list = await fetch(BASE + '/api/clients', { headers: { Authorization: 'Bearer ' + tok } });
    const listJson = await list.json();
    check('clients.list 200 (tenant-scoped)', list.status === 200 && Array.isArray(listJson?.data?.data), 'status=' + list.status);

    const me = await fetch(BASE + '/api/me', { headers: { Authorization: 'Bearer ' + tok } });
    const meJson = await me.json();
    check('me has clients.read', (meJson?.data?.permissions || []).includes('clients.read'));

    const cross = await fetch(BASE + '/api/clients/00000000-0000-0000-0000-000000000000', { headers: { Authorization: 'Bearer ' + tok } });
    check('unknown client -> 404 (no leak)', cross.status === 404, 'status=' + cross.status);
  } catch (e) {
    fail++; console.log('  FAIL exception', e.message);
  }

  console.log(`\nLOCAL SMOKE: ${pass} passed, ${fail} failed`);
  child.kill('SIGKILL');
  process.exit(fail === 0 ? 0 : 1);
})();

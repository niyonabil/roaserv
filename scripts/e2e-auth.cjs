/**
 * Self-contained E2E test for the Auth + RBAC module.
 * Starts the API, runs the full flow against live Supabase, prints PASS/FAIL, exits.
 * Run: DATABASE_URL=... node scripts/e2e-auth.cjs
 */
const http = require('http');
const { createApp } = require('../dist/api-test.cjs');

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: 'localhost', port: 4101, path, method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); } catch { resolve({ status: res.statusCode, body: buf }); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

let pass = 0, fail = 0;
function check(name, cond, extra) { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, extra ? JSON.stringify(extra) : ''); } }

(async () => {
  const server = createApp().listen(4101);
  await new Promise((r) => setTimeout(r, 800));

  console.log('\n[1] LOGIN (valid admin)');
  const login = await req('POST', '/api/auth/login', { identifier: 'admin', password: 'Roa0629605450' });
  check('login success', login.status === 200 && login.body.success, login.body);
  const token = login.body?.data?.accessToken;
  check('access token returned', typeof token === 'string' && token.length > 20);
  check('token has perms', Array.isArray(login.body?.data?.user?.perms) && login.body.data.user.perms.includes('manage_users'));
  check('token has roles', login.body?.data?.user?.roles?.includes('admin'));

  console.log('\n[2] /api/me (authed)');
  const me = await req('GET', '/api/me', null, token);
  check('me returns tenantId + perms', me.status === 200 && me.body?.data?.tenantId && Array.isArray(me.body.data.permissions));

  console.log('\n[3] /api/roles (manage_users)');
  const roles = await req('GET', '/api/roles', null, token);
  check('roles listed', roles.status === 200 && Array.isArray(roles.body?.data) && roles.body.data.length >= 1);
  check('admin role has permissions attached', roles.body.data[0]?.permissions?.includes('manage_users'));

  console.log('\n[4] /api/permissions catalog');
  const perms = await req('GET', '/api/permissions', null, token);
  check('permission catalog', perms.status === 200 && perms.body.data.length >= 16);

  console.log('\n[5] Unauthenticated -> 401');
  const noTok = await req('GET', '/api/roles', null, null);
  check('401 without token', noTok.status === 401);

  console.log('\n[6] Wrong password -> 401');
  const bad = await req('POST', '/api/auth/login', { identifier: 'admin', password: 'wrong' });
  check('reject bad password', bad.status === 401);

  console.log('\n[7] Refresh token');
  const refreshBody = { refreshToken: login.body?.data?.refreshToken };
  console.log('   refreshToken present:', !!refreshBody.refreshToken, 'len:', (refreshBody.refreshToken||'').length);
  const refresh = await req('POST', '/api/auth/refresh', refreshBody);
  console.log('   refresh status:', refresh.status, 'body:', JSON.stringify(refresh.body).slice(0,200));
  check('refresh returns new tokens', refresh.status === 200 && refresh.body?.data?.accessToken);

  console.log('\n[8] RBAC: create custom role (manage_users)');
  const newRole = await req('POST', '/api/roles', { name: 'test_role_' + Date.now() }, token);
  check('role created', newRole.status === 201 && newRole.body?.data?.id);

  console.log('\n[9] RBAC: assign permission to role');
  if (newRole.body?.data?.id) {
    const permId = perms.body.data[0].id;
    const assign = await req('POST', `/api/roles/${newRole.body.data.id}/permissions`, { permissionId: permId }, token);
    check('permission assigned', assign.status === 201);
  }

  console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`);
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('E2E CRASH', e); process.exit(2); });

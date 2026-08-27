/**
 * E2E: Security Gate + Clients module against live Supabase.
 * Covers: Auth 13/13 (subset re-run), tenant isolation, RBAC, Zod validation,
 * and the mandatory security tests (Test 1-10 + Clients CRUD + perms).
 * Run: DATABASE_URL=... node scripts/e2e-clients.cjs
 */
const http = require('http');
const { createApp } = require('../dist/api-test.cjs');
const { Pool } = require('pg');

const POOL = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: 'localhost', port: 4102, path, method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } }, (res) => {
      let buf = ''; res.on('data', (c) => (buf += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); } catch { resolve({ status: res.statusCode, body: buf }); } });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

let pass = 0, fail = 0;
function check(name, cond, extra) { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, extra ? JSON.stringify(extra).slice(0, 200) : ''); } }

// Setup second tenant + users via raw SQL (test fixtures).
async function setupFixtures() {
  // Idempotency: remove any leftover fixtures from prior runs.
  await POOL.query("DELETE FROM client WHERE customer_code IN ('CLI-A1','CLI-B1')");
  await POOL.query("DELETE FROM app_user WHERE username IN ('reader','fulladmin')");
  await POOL.query("DELETE FROM tenant WHERE slug LIKE 'tenant_b_%'");

  // tenant B
  const tB = await POOL.query("INSERT INTO tenant (id,name,slug,subscription_tier,status) VALUES ($1,$2,$3,'trial','active') ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name RETURNING id", [require('crypto').randomUUID(), 'Tenant B', 'tenant_b_' + Date.now(), ]);
  const tenantB = tB.rows[0].id;

  // roles: reader-only (clients.read), and a full client-admin for B
  const permRows = await POOL.query('SELECT id,code FROM permission');
  const permMap = {}; permRows.rows.forEach(p => permMap[p.code] = p.id);

  const mkRole = async (name, codes) => {
    const r = await POOL.query('INSERT INTO role (id,tenant_id,name,is_custom,is_system) VALUES ($1,$2,$3,true,false) RETURNING id', [require('crypto').randomUUID(), tenantB, name]);
    const roleId = r.rows[0].id;
    for (const c of codes) { if (permMap[c]) await POOL.query('INSERT INTO role_permission (role_id,permission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [roleId, permMap[c]]); }
    return roleId;
  };
  const readerRole = await mkRole('reader_only_b', ['clients.read']);
  const fullRole = await mkRole('client_admin_b', ['clients.read', 'clients.create', 'clients.update', 'clients.delete']);

  const mkUser = async (username, roleId) => {
    const hash = await require('bcryptjs').hash('Password123', 10);
    const u = await POOL.query('INSERT INTO app_user (id,tenant_id,email,username,password_hash,name,status,email_verified) VALUES ($1,$2,$3,$4,$5,$6,\'active\',true) RETURNING id', [require('crypto').randomUUID(), tenantB, username + '@b.com', username, hash, 'User ' + username]);
    const uid = u.rows[0].id;
    await POOL.query('INSERT INTO user_role (user_id,role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [uid, roleId]);
    return uid;
  };
  const readerUser = await mkUser('reader', readerRole);
  const fullUser = await mkUser('fulladmin', fullRole);

  await POOL.end();
  return { tenantB, readerUser, fullUser };
}

(async () => {
  const server = createApp().listen(4102);
  await new Promise((r) => setTimeout(r, 600));
  const fx = await setupFixtures();

  // ---- AUTH (re-run core 13/13 truths) ----
  console.log('\n[AUTH]');
  const loginAdmin = await req('POST', '/api/auth/login', { identifier: 'admin', password: 'Roa0629605450' });
  check('admin login', loginAdmin.status === 200 && loginAdmin.body.success, loginAdmin.body);
  const adminTok = loginAdmin.body?.data?.accessToken;
  check('admin has clients.* perms', ['clients.read','clients.create','clients.update','clients.delete'].every(p => loginAdmin.body.data.user.perms.includes(p)));

  // ---- SECURITY GATE: TENANT ISOLATION ----
  console.log('\n[SECURITY GATE — tenant isolation]');
  // admin (tenant A) creates a client
  const createA = await req('POST', '/api/clients', { name: 'Client A1', customerCode: 'CLI-A1', clientType: 'company', tenantId: fx.tenantB /* must be ignored */ }, adminTok);
  check('Test1: tenant A creates client (ignores supplied tenantId)', createA.status === 201 && createA.body.success, createA.body);
  const clientAId = createA.body?.data?.id;
  check('Test1b: created client belongs to A, not supplied B', createA.body?.data?.tenantId !== fx.tenantB);
  // tenant A can read it
  const readA = await req('GET', '/api/clients/' + clientAId, null, adminTok);
  check('Test2: tenant A reads own client', readA.status === 200 && readA.body.success);

  // login users from tenant B
  const loginReader = await req('POST', '/api/auth/login', { identifier: 'reader', password: 'Password123' });
  const readerTok = loginReader.body?.data?.accessToken;
  const loginFull = await req('POST', '/api/auth/login', { identifier: 'fulladmin', password: 'Password123' });
  const fullTok = loginFull.body?.data?.accessToken;
  check('tenant B users login', loginReader.status === 200 && loginFull.status === 200);

  // Test3: tenant B cannot read tenant A's client
  const crossRead = await req('GET', '/api/clients/' + clientAId, null, fullTok);
  check('Test3: tenant B cannot READ tenant A client', crossRead.status === 404, crossRead.status);
  // Test4: tenant B cannot update
  const crossUpd = await req('PATCH', '/api/clients/' + clientAId, { name: 'hacked' }, fullTok);
  check('Test4: tenant B cannot UPDATE tenant A client', crossUpd.status === 404, crossUpd.status);
  // Test5: tenant B cannot delete
  const crossDel = await req('DELETE', '/api/clients/' + clientAId, null, fullTok);
  check('Test5: tenant B cannot DELETE tenant A client', crossDel.status === 404, crossDel.status);
  // Test10: supplying tenant_id in body is ignored (already proven in Test1)

  // ---- RBAC permission checks ----
  console.log('\n[RBAC]');
  // Test6: reader (no create) -> 403
  const rCreate = await req('POST', '/api/clients', { name: 'x' }, readerTok);
  check('Test6: no clients.create -> 403', rCreate.status === 403, rCreate.status);
  // Test7: reader (no create) on create already 403; create path covered
  // Test8: reader (no update) -> 403
  const rUpdate = await req('PATCH', '/api/clients/' + clientAId, { name: 'y' }, readerTok);
  check('Test8: no clients.update -> 403', rUpdate.status === 403, rUpdate.status);
  // Test9: reader (no delete) -> 403
  const rDelete = await req('DELETE', '/api/clients/' + clientAId, null, readerTok);
  check('Test9: no clients.delete -> 403', rDelete.status === 403, rDelete.status);
  // Test7 explicit: a user without clients.create (reader) -> 403 (same as rCreate)
  check('Test7: no clients.create -> 403 (reader)', rCreate.status === 403);

  // ---- CLIENTS CRUD (full admin of tenant B) ----
  console.log('\n[CLIENTS CRUD — tenant B]');
  const cB = await req('POST', '/api/clients', { name: 'Client B1', customerCode: 'CLI-B1', clientType: 'individual' }, fullTok);
  check('create client (tenant B)', cB.status === 201 && cB.body.success, cB.body);
  const cBId = cB.body?.data?.id;
  const readB = await req('GET', '/api/clients/' + cBId, null, fullTok);
  check('read client (tenant B)', readB.status === 200 && readB.body.success);
  const updB = await req('PATCH', '/api/clients/' + cBId, { city: 'Casablanca', creditLimit: 5000 }, fullTok);
  check('update client (tenant B)', updB.status === 200 && updB.body.data.city === 'Casablanca', updB.body);
  const delB = await req('DELETE', '/api/clients/' + cBId, null, fullTok);
  check('delete (soft) client (tenant B)', delB.status === 200 && delB.body.data.status === 'inactive', delB.body);
  const listB = await req('GET', '/api/clients?page=1&pageSize=10', null, fullTok);
  check('list clients (tenant B)', listB.status === 200 && Array.isArray(listB.body.data.data));

  // ---- VALIDATION (Zod) ----
  console.log('\n[VALIDATION]');
  const vMissing = await req('POST', '/api/clients', {}, fullTok); // missing name
  check('invalid (missing name) -> 400', vMissing.status === 400, vMissing.status);
  const vEmail = await req('POST', '/api/clients', { name: 'z', email: 'not-an-email' }, fullTok);
  check('invalid email -> 400', vEmail.status === 400, vEmail.status);
  const vDup = await req('POST', '/api/clients', { name: 'dup', customerCode: 'CLI-B1' }, fullTok); // duplicate code in B
  check('duplicate customerCode in tenant -> 409', vDup.status === 409, vDup.status);

  // ---- UNAUTHENTICATED ----
  console.log('\n[UNAUTH]');
  const noTok = await req('GET', '/api/clients', null, null);
  check('no token -> 401', noTok.status === 401, noTok.status);

  // ---- confirm cross-tenant list isolation: B cannot see A's client ----
  const listB2 = await req('GET', '/api/clients?search=Client%20A1', null, fullTok);
  check('tenant B list does NOT leak tenant A client', listB2.body.data.data.find(c => c.id === clientAId) === undefined);

  console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`);
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('E2E CRASH', e); process.exit(2); });

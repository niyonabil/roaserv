/**
 * E2E: Billing + Stock modules against live Supabase (new architecture).
 * Covers: tenant isolation (fail-closed), RBAC 403, 401, Zod 400.
 * Run: DATABASE_URL=... JWT_SECRET=... JWT_REFRESH_SECRET=... node scripts/e2e-billing-stock.cjs
 */
const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createApp } = require('../dist/api-test.cjs');
const { Pool } = require('pg');

const POOL = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: 'localhost', port: 4103, path, method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } }, (res) => {
      let buf = ''; res.on('data', (c) => (buf += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); } catch { resolve({ status: res.statusCode, body: buf }); } });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
let pass = 0, fail = 0;
function check(name, cond, extra) { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, extra ? JSON.stringify(extra).slice(0, 200) : ''); } }

async function setupFixtures() {
  // Remove billing rows referencing the fixtures first (FK).
  await POOL.query("DELETE FROM invoice_line WHERE invoice_id IN (SELECT id FROM invoice WHERE number LIKE 'INV-E2E-%')");
  await POOL.query("DELETE FROM invoice WHERE number LIKE 'INV-E2E-%'");
  await POOL.query("DELETE FROM quotation WHERE number LIKE 'QUO-E2E-%'");
  await POOL.query("DELETE FROM payment WHERE reference LIKE 'PAY-E2E-%'");
  await POOL.query("DELETE FROM stock_movement WHERE material_id IN (SELECT id FROM material WHERE sku LIKE 'E2E-%')");
  await POOL.query("DELETE FROM material WHERE sku LIKE 'E2E-%'");
  await POOL.query("DELETE FROM client WHERE customer_code IN ('E2E-BILL','E2E-STK')");
  await POOL.query("DELETE FROM app_user WHERE username IN ('e2e_reader','e2e_full')");
  await POOL.query("DELETE FROM tenant WHERE slug LIKE 'e2e_tenant_%'");

  const tB = await POOL.query("INSERT INTO tenant (id,name,slug,subscription_tier,status) VALUES ($1,$2,$3,'trial','active') ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name RETURNING id",
    [crypto.randomUUID(), 'E2E Tenant B', 'e2e_tenant_' + Date.now()]);
  const tenantB = tB.rows[0].id;

  const permRows = await POOL.query('SELECT id,code FROM permission');
  const permMap = {}; permRows.rows.forEach(p => permMap[p.code] = p.id);

  const mkRole = async (name, codes) => {
    const r = await POOL.query('INSERT INTO role (id,tenant_id,name,is_custom,is_system) VALUES ($1,$2,$3,true,false) RETURNING id', [crypto.randomUUID(), tenantB, name]);
    const roleId = r.rows[0].id;
    for (const c of codes) if (permMap[c]) await POOL.query('INSERT INTO role_permission (role_id,permission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [roleId, permMap[c]]);
    return roleId;
  };
  const readerRole = await mkRole('e2e_reader_b', ['billing.read', 'stock.read']);
  const fullRole = await mkRole('e2e_full_b', ['billing.read','billing.create','billing.update','billing.delete','stock.read','stock.create','stock.update','stock.delete']);

  const mkUser = async (username, roleId) => {
    const hash = await bcrypt.hash('Password123', 10);
    const u = await POOL.query('INSERT INTO app_user (id,tenant_id,email,username,password_hash,name,status,email_verified) VALUES ($1,$2,$3,$4,$5,$6,\'active\',true) RETURNING id',
      [crypto.randomUUID(), tenantB, username + '@b.com', username, hash, 'E2E ' + username]);
    const uid = u.rows[0].id;
    await POOL.query('INSERT INTO user_role (user_id,role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [uid, roleId]);
    return uid;
  };
  await mkUser('e2e_reader', readerRole);
  await mkUser('e2e_full', fullRole);
  await POOL.end();
  return { tenantB };
}

(async () => {
  const server = createApp().listen(4103);
  await new Promise((r) => setTimeout(r, 600));
  await setupFixtures();

  console.log('\n[AUTH]');
  const loginAdmin = await req('POST', '/api/auth/login', { identifier: 'admin', password: 'Roa0629605450' });
  check('admin login', loginAdmin.status === 200 && loginAdmin.body.success, loginAdmin.body);
  const adminTok = loginAdmin.body?.data?.accessToken;
  check('admin has billing.* + stock.* perms',
    ['billing.read','billing.create','billing.update','billing.delete','stock.read','stock.create','stock.update','stock.delete'].every(p => loginAdmin.body.data.user.perms.includes(p)));

  // client for billing
  const clientA = await req('POST', '/api/clients', { name: 'E2E Bill Client', customerCode: 'E2E-BILL', clientType: 'company' }, adminTok);
  check('create client for billing', clientA.status === 201 && clientA.body.success, clientA.body);
  const clientId = clientA.body?.data?.id;

  const loginReader = await req('POST', '/api/auth/login', { identifier: 'e2e_reader', password: 'Password123' });
  const readerTok = loginReader.body?.data?.accessToken;
  const loginFull = await req('POST', '/api/auth/login', { identifier: 'e2e_full', password: 'Password123' });
  const fullTok = loginFull.body?.data?.accessToken;
  check('tenant B users login', loginReader.status === 200 && loginFull.status === 200);

  console.log('\n[BILLING — tenant isolation]');
  const qA = await req('POST', '/api/quotes', { clientId, number: 'QUO-E2E-A', totalHt: 100, vat: 20, totalTtc: 120, tenantId: '00000000-0000-0000-0000-000000000000' /* ignored */ }, adminTok);
  check('tenant A creates quote (ignores supplied tenantId)', qA.status === 201 && qA.body.success, qA.body);
  const quoteAId = qA.body?.data?.id;
  check('quote belongs to A, not supplied id', qA.body?.data?.tenantId !== '00000000-0000-0000-0000-000000000000');

  const invA = await req('POST', '/api/invoices', { clientId, number: 'INV-E2E-A', ht: 200, vat: 40, ttc: 240 }, adminTok);
  check('tenant A creates invoice', invA.status === 201 && invA.body.success, invA.body);
  const invAId = invA.body?.data?.id;

  const crossRead = await req('GET', '/api/quotes/' + quoteAId, null, fullTok);
  check('tenant B cannot READ tenant A quote', crossRead.status === 404, crossRead.status);
  const crossInv = await req('GET', '/api/invoices/' + invAId, null, fullTok);
  check('tenant B cannot READ tenant A invoice', crossInv.status === 404, crossInv.status);
  const crossList = await req('GET', '/api/invoices', null, fullTok);
  check('tenant B lists only its own invoices (0)', crossList.status === 200 && Array.isArray(crossList.body?.data?.data) && crossList.body.data.data.length === 0, crossList.body);

  console.log('\n[BILLING — RBAC + auth]');
  const rCreate = await req('POST', '/api/quotes', { clientId, number: 'X' }, readerTok);
  check('reader (no billing.create) -> 403', rCreate.status === 403, rCreate.status);
  const noTok = await req('GET', '/api/quotes', null, null);
  check('no token -> 401', noTok.status === 401, noTok.status);
  const badZod = await req('POST', '/api/quotes', { clientId: 'not-a-uuid' }, adminTok);
  check('invalid clientId -> 400', badZod.status === 400, badZod.status);

  console.log('\n[STOCK — tenant isolation]');
  const mvtA = await req('POST', '/api/stock', { sku: 'E2E-A4', name: 'Papier A4', category: 'Papier', unit: 'feuille', qtyOnHand: 100, tenantId: '00000000-0000-0000-0000-000000000000' }, adminTok);
  check('tenant A creates material (ignores supplied tenantId)', mvtA.status === 201 && mvtA.body.success, mvtA.body);
  const stockAId = mvtA.body?.data?.id;

  const crossStk = await req('GET', '/api/stock/' + stockAId, null, fullTok);
  check('tenant B cannot READ tenant A material', crossStk.status === 404, crossStk.status);
  const crossStkList = await req('GET', '/api/stock', null, fullTok);
  check('tenant B lists only its own stock (0)', crossStkList.status === 200 && Array.isArray(crossStkList.body?.data?.data) && crossStkList.body.data.data.length === 0, crossStkList.body);

  console.log('\n[STOCK — RBAC + auth]');
  const rStkCreate = await req('POST', '/api/stock', { name: 'x' }, readerTok);
  check('reader (no stock.create) -> 403', rStkCreate.status === 403, rStkCreate.status);
  const noTokStk = await req('GET', '/api/stock', null, null);
  check('no token -> 401', noTokStk.status === 401, noTokStk.status);
  const badStk = await req('POST', '/api/stock', { sku: 'X', name: 'Y', category: 'Z', qtyOnHand: 'abc' }, adminTok);
  check('invalid qtyOnHand -> 400', badStk.status === 400, badStk.status);

  console.log('\n==== RESULT: ' + pass + ' passed, ' + fail + ' failed ====');
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });

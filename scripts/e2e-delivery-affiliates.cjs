/**
 * E2E: Delivery + Affiliates modules against live Supabase (new architecture).
 * Tenant isolation (fail-closed), RBAC 403, 401, Zod 400.
 * Run: DATABASE_URL=... JWT_SECRET=... JWT_REFRESH_SECRET=... node scripts/e2e-delivery-affiliates.cjs
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
    const r = http.request({ host: 'localhost', port: 4105, path, method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } }, (res) => {
      let buf = ''; res.on('data', (c) => (buf += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); } catch { resolve({ status: res.statusCode, body: buf }); } });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
let pass = 0, fail = 0;
function check(name, cond, extra) { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, extra ? JSON.stringify(extra).slice(0, 200) : ''); } }

async function setupFixtures() {
  await POOL.query("DELETE FROM delivery_attempt WHERE delivery_id IN (SELECT id FROM delivery WHERE project_id IN (SELECT id FROM project WHERE reference LIKE 'E2E-DLV%'))");
  await POOL.query("DELETE FROM delivery WHERE project_id IN (SELECT id FROM project WHERE reference LIKE 'E2E-DLV%')");
  await POOL.query("DELETE FROM project WHERE reference LIKE 'E2E-DLV%'");
  await POOL.query("DELETE FROM commission WHERE affiliate_id IN (SELECT id FROM affiliate WHERE code LIKE 'E2E-AFF%')");
  await POOL.query("DELETE FROM affiliate_referral WHERE affiliate_id IN (SELECT id FROM affiliate WHERE code LIKE 'E2E-AFF%')");
  await POOL.query("DELETE FROM affiliate WHERE code LIKE 'E2E-AFF%'");
  await POOL.query("DELETE FROM client WHERE customer_code IN ('E2E-DLVCL','E2E-DLVCLB','E2E-AFFCL')");
  await POOL.query("DELETE FROM app_user WHERE username IN ('e2e_dr','e2e_dm')");
  await POOL.query("DELETE FROM tenant WHERE slug LIKE 'e2e_da_%'");

  const tB = await POOL.query("INSERT INTO tenant (id,name,slug,subscription_tier,status) VALUES ($1,$2,$3,'trial','active') ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name RETURNING id",
    [crypto.randomUUID(), 'E2E DA B', 'e2e_da_' + Date.now()]);
  const tenantB = tB.rows[0].id;

  const permRows = await POOL.query('SELECT id,code FROM permission');
  const permMap = {}; permRows.rows.forEach(p => permMap[p.code] = p.id);
  const mkRole = async (name, codes) => {
    const r = await POOL.query('INSERT INTO role (id,tenant_id,name,is_custom,is_system) VALUES ($1,$2,$3,true,false) RETURNING id', [crypto.randomUUID(), tenantB, name]);
    const roleId = r.rows[0].id;
    for (const c of codes) if (permMap[c]) await POOL.query('INSERT INTO role_permission (role_id,permission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [roleId, permMap[c]]);
    return roleId;
  };
  const readerRole = await mkRole('e2e_dr', ['delivery.read', 'affiliates.read']);
  const fullRole = await mkRole('e2e_dm', ['delivery.read','delivery.create','delivery.update','delivery.delete','affiliates.read','affiliates.manage']);
  const mkUser = async (username, roleId) => {
    const hash = await bcrypt.hash('Password123', 10);
    const u = await POOL.query('INSERT INTO app_user (id,tenant_id,email,username,password_hash,name,status,email_verified) VALUES ($1,$2,$3,$4,$5,$6,\'active\',true) RETURNING id',
      [crypto.randomUUID(), tenantB, username + '@b.com', username, hash, 'E2E ' + username]);
    const uid = u.rows[0].id;
    await POOL.query('INSERT INTO user_role (user_id,role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [uid, roleId]);
    return uid;
  };
  await mkUser('e2e_dr', readerRole);
  await mkUser('e2e_dm', fullRole);
  await POOL.end();
  return { tenantB };
}

(async () => {
  const server = createApp().listen(4105);
  await new Promise((r) => setTimeout(r, 600));
  await setupFixtures();

  console.log('\n[AUTH]');
  const loginAdmin = await req('POST', '/api/auth/login', { identifier: 'admin', password: 'Roa0629605450' });
  check('admin login', loginAdmin.status === 200 && loginAdmin.body.success, loginAdmin.body);
  const adminTok = loginAdmin.body?.data?.accessToken;
  check('admin has delivery.* + affiliates.*', ['delivery.read','delivery.create','delivery.update','delivery.delete','affiliates.read','affiliates.manage'].every(p => loginAdmin.body.data.user.perms.includes(p)));

  const loginReader = await req('POST', '/api/auth/login', { identifier: 'e2e_dr', password: 'Password123' });
  const readerTok = loginReader.body?.data?.accessToken;
  const loginFull = await req('POST', '/api/auth/login', { identifier: 'e2e_dm', password: 'Password123' });
  const fullTok = loginFull.body?.data?.accessToken;
  check('tenant B users login', loginReader.status === 200 && loginFull.status === 200);

  // project fixture for delivery FK (tenant A) — project needs clientId + reference
  const { Pool: P2 } = require('pg');
  const pool2 = new P2({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const tenantAId = (await pool2.query("SELECT id FROM tenant WHERE slug='roa'")).rows[0].id;
  const cliA = await pool2.query("INSERT INTO client (id,tenant_id,customer_code,name,client_type) VALUES ($1,$2,$3,$4,$5) RETURNING id", [crypto.randomUUID(), tenantAId, 'E2E-DLVCL', 'E2E Delivery Client', 'company']);
  const cliAId = cliA.rows[0].id;
  const tenantBId = (await pool2.query("SELECT id FROM tenant WHERE slug LIKE 'e2e_da_%' ORDER BY created_at DESC LIMIT 1")).rows[0].id;
  const cliB = await pool2.query("INSERT INTO client (id,tenant_id,customer_code,name,client_type) VALUES ($1,$2,$3,$4,$5) RETURNING id", [crypto.randomUUID(), tenantBId, 'E2E-DLVCLB', 'E2E Delivery Client B', 'company']);
  const cliBId = cliB.rows[0].id;
  const projA = await pool2.query("INSERT INTO project (id,tenant_id,reference,client_id) VALUES ($1,$2,$3,$4) RETURNING id", [crypto.randomUUID(), tenantAId, 'E2E-DLV-A', cliAId]);
  const projectAId = projA.rows[0].id;
  const projB = await pool2.query("INSERT INTO project (id,tenant_id,reference,client_id) VALUES ($1,$2,$3,$4) RETURNING id", [crypto.randomUUID(), tenantBId, 'E2E-DLV-B', cliBId]);
  const projectBId = projB.rows[0].id;

  console.log('\n[DELIVERY — tenant isolation]');
  const dA = await req('POST', '/api/deliveries', { projectId: projectAId, mode: 'local', city: 'Casablanca', tenantId: '00000000-0000-0000-0000-000000000000' }, adminTok);
  check('tenant A creates delivery (ignores supplied tenantId)', dA.status === 201 && dA.body.success, dA.body);
  const dAId = dA.body?.data?.id;
  const crossRead = await req('GET', '/api/deliveries/' + dAId, null, fullTok);
  check('tenant B cannot READ tenant A delivery', crossRead.status === 404, crossRead.status);
  const crossList = await req('GET', '/api/deliveries', null, fullTok);
  check('tenant B lists only its own deliveries (0)', crossList.status === 200 && Array.isArray(crossList.body?.data?.data) && crossList.body.data.data.length === 0, crossList.body);

  console.log('\n[DELIVERY — RBAC + auth]');
  const rCreate = await req('POST', '/api/deliveries', { projectId: projectAId }, readerTok);
  check('reader (no delivery.create) -> 403', rCreate.status === 403, rCreate.status);
  const noTok = await req('GET', '/api/deliveries', null, null);
  check('no token -> 401', noTok.status === 401, noTok.status);
  const badZod = await req('POST', '/api/deliveries', { projectId: '' }, adminTok);
  check('invalid projectId -> 400', badZod.status === 400, badZod.status);

  console.log('\n[AFFILIATES — tenant isolation + commission]');
  const aA = await req('POST', '/api/affiliates', { code: 'E2E-AFF-A', name: 'Aff A', commissionModel: 'percentage', tenantId: '00000000-0000-0000-0000-000000000000' }, adminTok);
  check('tenant A creates affiliate (ignores supplied tenantId)', aA.status === 201 && aA.body.success, aA.body);
  const aAId = aA.body?.data?.id;
  // record a referral -> commission computed server-side
  const clientA = await req('POST', '/api/clients', { name: 'E2E Aff Client', customerCode: 'E2E-AFFCL', clientType: 'company' }, adminTok);
  const clientAId = clientA.body?.data?.id;
  const ref = await req('POST', '/api/affiliates/' + aAId + '/referrals', { clientId: clientAId, orderValue: 1000, commissionRate: 10 }, adminTok);
  check('referral recorded + commission computed (10% of 1000=100)', ref.status === 201 && Math.abs(Number(ref.body?.data?.computedAmount) - 100) < 0.01, ref.body);
  const crossAff = await req('GET', '/api/affiliates/' + aAId, null, fullTok);
  check('tenant B cannot READ tenant A affiliate', crossAff.status === 404, crossAff.status);

  console.log('\n[AFFILIATES — RBAC + auth]');
  const rAff = await req('POST', '/api/affiliates', { code: 'X', name: 'Y' }, readerTok);
  check('reader (no affiliates.manage) -> 403', rAff.status === 403, rAff.status);
  const noTokAff = await req('GET', '/api/affiliates', null, null);
  check('no token -> 401', noTokAff.status === 401, noTokAff.status);

  await pool2.end();
  console.log('\n==== RESULT: ' + pass + ' passed, ' + fail + ' failed ====');
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });

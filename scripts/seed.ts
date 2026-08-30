/**
 * Seed: permission catalog + default tenant (roa) + system 'admin' role + admin user.
 * Idempotent. Run once: `node dist/server/seed.js` (compiled) or via ts runner.
 */
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const PERMISSIONS = [
  'view', 'create', 'edit', 'delete', 'approve', 'validate', 'print', 'export',
  'pay', 'refund', 'manage_stock', 'manage_machines', 'manage_users', 'manage_prices',
  'manage_commissions', 'view_financials',
  'clients.read', 'clients.create', 'clients.update', 'clients.delete',
  'billing.read', 'billing.create', 'billing.update', 'billing.delete',
  'stock.read', 'stock.create', 'stock.update', 'stock.delete',
  'machines.read', 'machines.manage',
  'delivery.read', 'delivery.create', 'delivery.update', 'delivery.delete',
  'affiliates.read', 'affiliates.manage',
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. permission catalog
    for (const code of PERMISSIONS) {
      await client.query(
        `INSERT INTO permission (id, code, description) VALUES ($1,$2,$3)
         ON CONFLICT (code) DO NOTHING`,
        [randomUUID(), code, code],
      );
    }

    // 2. default tenant
    let { rows: t } = await client.query(`SELECT id FROM tenant WHERE slug=$1`, ['roa']);
    let tenantId: string;
    if (!t.length) {
      const r = await client.query(
        `INSERT INTO tenant (id,name,slug,subscription_tier,status) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [randomUUID(), 'ROA Services (défaut)', 'roa', 'trial', 'active'],
      );
      tenantId = r.rows[0].id;
    } else {
      tenantId = t[0].id;
    }

    // 3. system admin role with all permissions
    let { rows: roles } = await client.query(`SELECT id FROM role WHERE tenant_id=$1 AND name=$2`, [tenantId, 'admin']);
    let adminRoleId: string;
    if (!roles.length) {
      const r = await client.query(
        `INSERT INTO role (id,tenant_id,name,is_custom,is_system) VALUES ($1,$2,$3,false,true) RETURNING id`,
        [randomUUID(), tenantId, 'admin'],
      );
      adminRoleId = r.rows[0].id;
    } else {
      adminRoleId = roles[0].id;
    }
    // Always (re)grant the full permission catalog to the admin role so that
    // newly added permissions (e.g. billing.*) are picked up idempotently.
    {
      const permRows = await client.query(`SELECT id, code FROM permission`);
      for (const p of permRows.rows) {
        await client.query(
          `INSERT INTO role_permission (role_id, permission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [adminRoleId, p.id],
        );
      }
    }

    // 4. admin user
    const { rows: users } = await client.query(`SELECT id FROM app_user WHERE tenant_id=$1 AND username=$2`, [tenantId, 'admin']);
    if (!users.length) {
      const hash = await bcrypt.hash('Roa0629605450', 10);
      const r = await client.query(
        `INSERT INTO app_user (id,tenant_id,email,username,password_hash,name,status,email_verified)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true) RETURNING id`,
        [randomUUID(), tenantId, 'admin@roaserv.com', 'admin', hash, 'Administrateur ROA', 'active'],
      );
      await client.query(
        `INSERT INTO user_role (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [r.rows[0].id, adminRoleId],
      );
      console.log('Created admin user admin@roaserv.com / Roa0629605450 (tenant roa)');
    } else {
      console.log('Admin user already exists');
    }

    await client.query('COMMIT');
    console.log('Seed complete. tenantId=', tenantId);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();

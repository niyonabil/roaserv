#!/usr/bin/env node
/*
 * ROA Services — RLS coverage validation (READ-ONLY).
 *
 * Connects to the database and verifies that EVERY business table that carries a
 * `tenant_id` column has Row-Level Security enabled (relrowsecurity = true).
 *
 * This is the ground-truth check requested in the RLS hardening task: it derives
 * the "expected" list directly from the live schema (tables in public that own a
 * tenant_id column), then compares against the tables that actually have RLS on.
 *
 * It ONLY runs SELECT statements. It never enables, alters, or drops anything.
 * Safe to run against production (read-only).
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." node scripts/verify-rls.cjs
 *
 * Exit code: 0 = all tenant-bearing tables have RLS; 1 = some are missing.
 */

const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('[verify-rls] ERROR: DATABASE_URL is not set. Export it before running.');
  process.exit(2);
}

async function main() {
  const client = new Client({ connectionString });
  await client.connect();

  // Expected: every base table in public that owns a tenant_id column.
  const expectedRes = await client.query(`
    SELECT t.table_name
    FROM information_schema.tables t
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = t.table_schema
          AND c.table_name = t.table_name
          AND c.column_name = 'tenant_id'
      )
    ORDER BY t.table_name;
  `);
  const expected = expectedRes.rows.map((r) => r.table_name);

  // Actual: tables with Row-Level Security enabled.
  const rlsRes = await client.query(`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity
    ORDER BY c.relname;
  `);
  const rlsOn = new Set(rlsRes.rows.map((r) => r.table_name));

  await client.end();

  const missing = expected.filter((t) => !rlsOn.has(t));

  console.log('==================================================');
  console.log(' ROA Services — RLS coverage validation (read-only)');
  console.log('==================================================');
  console.log(` Tenant-bearing tables (expected): ${expected.length}`);
  console.log(` Tables with RLS enabled:          ${rlsOn.size}`);
  console.log('--------------------------------------------------');

  if (missing.length === 0) {
    console.log(' OK: every tenant-bearing table has RLS enabled.');
    console.log('==================================================');
    process.exit(0);
  } else {
    console.log(' MISSING RLS on the following tenant-bearing tables:');
    for (const t of missing) {
      console.log(`   - ${t}`);
    }
    console.log('--------------------------------------------------');
    console.log(' ACTION: run scripts/enable-rls.sql (or add them to tbls).');
    console.log('==================================================');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[verify-rls] ERROR:', err.message);
  process.exit(3);
});

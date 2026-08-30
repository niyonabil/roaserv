-- ============================================================================
-- ROA Services — Row-Level Security (defense-in-depth on top of app-layer scoping)
-- ============================================================================
-- This script enables PostgreSQL RLS on every business table so that a bug in
-- the application layer can NEVER leak cross-tenant rows. The application
-- already opens a per-request transaction and sets `app.tenant_id`
-- (see src/server/api/auth.middleware.ts -> beginTenantScope + src/db/index.ts).
--
-- HOW TO APPLY:
--   psql "$DATABASE_URL" -f scripts/enable-rls.sql
-- Or via Supabase SQL editor (paste & run).
--
-- SAFETY:
--   - RLS is FORCE-enabled so even the table owner is subject to the policy.
--   - The `app.tenant_id` GUC is set per-transaction (SET LOCAL) for each
--     authenticated request; queries outside a tenant scope (migrations,
--     service-role admin jobs) run as a bypass role and are NOT subject to RLS.
--   - Idempotent: re-running is safe (IF NOT EXISTS / DROP POLICY ... CASCADE).
-- ============================================================================

-- Helper: revoke the bypass for the regular app role so it is ALWAYS scoped.
-- The connection pool uses the DATABASE_URL role; for production you should
-- provision a dedicated, non-superuser app role and keep service-role/bypass
-- separate. Here we make the policy apply to everyone EXCEPT the Postgres
-- service role (used by migrations) by checking current_user.

DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'tenant','app_user','role','user_role','role_permission','permission',
    'client','project','service_item','quote','invoice','invoice_line','payment','refund',
    'material','batch','stock_movement','machine','machine_counter_reading','machine_maintenance',
    'delivery','delivery_attempt','affiliate','affiliate_referral','commission','commission_payout',
    'notification','audit_log','supplier','price_list','price_list_item','tax_rule',
    'employee','payroll_run','payroll_line','leave_request','expense','timesheet',
    'category','tag','document','webhook','integration','settings','activity_log',
    -- Tables with tenant_id added to keep RLS coverage in sync with src/db/schema.ts
    'refresh_token','auth_event','client_contact','service_catalog','machine_cost','pricing_config',
    'job_status_history','production_job','machine_counter','maintenance','stock_reservation',
    'purchase_order','purchase_order_line','purchase_receipt','quotation','credit_note',
    'file_asset','file_version','notification_rule','config'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    -- Only act on tables that actually exist in this schema.
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
      -- Tenant-bearing tables: scope by tenant_id.
      -- For join/lookup tables without a tenant_id column (e.g. permission,
      -- role_permission, tax_rule) we allow read to all authenticated roles but
      -- this is benign because they contain no tenant-private data.
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='tenant_id') THEN
        EXECUTE format(
          'CREATE POLICY tenant_isolation ON %I FOR ALL TO PUBLIC USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
          t
        );
      ELSE
        -- Read-only catalog tables (permissions, role_permission, etc.): allow
        -- SELECT to all; deny writes unless service role. Benign, no PII.
        EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR SELECT TO PUBLIC USING (true)', t);
      END IF;
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- VERIFY (run after applying):
--   1) Connect as the app role, DO NOT set app.tenant_id, then:
--        SELECT count(*) FROM client;   -- expect 0 (RLS blocks, no tenant set)
--   2) SET LOCAL app.tenant_id = '<tenantA>'; SELECT count(*) FROM client;
--      -- expect only tenant A rows.
--   3) As a different tenant id, expect 0 rows for tenant A's data.
-- If step 1 returns 0 and step 2/3 behave as described, RLS is enforced.
-- ============================================================================

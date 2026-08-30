/**
 * ROA Services — database connection (Supabase PostgreSQL via pg + Drizzle).
 * Credentials are loaded from process.env (Vercel env / .env, never committed).
 *
 * MULTI-TENANT HARDENING (defense-in-depth on top of the application-layer
 * tenant scoping already present in every repository):
 *   - `setTenant(tx, tenantId)` sets the PostgreSQL GUC `app.tenant_id` for the
 *     current transaction (`SET LOCAL` semantics via set_config(..., true)).
 *   - Every authenticated request establishes a transaction-scoped `db` (see
 *     src/server/api/auth.middleware.ts -> beginTenantScope) and sets
 *     `app.tenant_id`. Row-Level Security policies (see scripts/enable-rls.sql)
 *     then enforce `tenant_id = current_setting('app.tenant_id')::uuid` at the
 *     database layer, so a bug in the app layer can never leak cross-tenant rows.
 *   - `db` is exported as a Proxy: inside a request it transparently delegates
 *     to the active transaction client, otherwise to the base pool connection.
 *     Repositories keep importing `{ db }` unchanged.
 */
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import * as schema from './schema';

const connectionString = process.env['DATABASE_URL'] ?? '';

if (!connectionString) {
  // Fail loud in non-Vercel dev so misconfiguration is obvious.
  console.error('[db] DATABASE_URL is not set. Set it in .env or Vercel env vars.');
}

export const pool = new Pool({
  connectionString,
  max: 10,
  ssl: process.env['NODE_ENV'] === 'production' ? { rejectUnauthorized: false } : false,
});

/** Base Drizzle instance bound to the shared pool (used outside request scope: login, refresh, migrations). */
export const baseDb: NodePgDatabase<typeof schema> = drizzle(pool, { schema });
export { schema };

/**
 * Per-request tenant context. Stored via AsyncLocalStorage so the `db` proxy
 * can resolve the correct transaction without threading it through every repo.
 */
export interface TenantCtx {
  tenantId: string;
  tx: any; // drizzle transaction client
}
export const tenantStorage = new AsyncLocalStorage<TenantCtx>();

/**
 * setTenant — establish the tenant context for the current (transaction-scoped)
 * database client. Implemented with `set_config(..., true)` which is equivalent
 * to `SET LOCAL app.tenant_id = <uuid>` but is safely parameterizable.
 *
 * MUST be called inside a transaction (db.transaction) so the setting is scoped
 * to that transaction and cannot leak into another tenant's request on a pooled
 * connection.
 */
export async function setTenant(tx: any, tenantId: string): Promise<void> {
  await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
}

/**
 * `db` proxy: repositories import this. Within an authenticated request it
 * delegates to the active transaction (`ctx.tx`); otherwise to the base pool.
 * This makes RLS (`app.tenant_id`) automatically apply to every repo query once
 * the request transaction is opened in auth.middleware.beginTenantScope.
 */
export const db = new Proxy(baseDb, {
  get(target, prop, receiver) {
    const ctx = tenantStorage.getStore();
    const delegate: any = ctx && ctx.tx ? ctx.tx : target;
    return Reflect.get(delegate, prop, delegate);
  },
}) as NodePgDatabase<typeof schema>;

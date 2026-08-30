# ROA Services — Security Hardening Report

Status: **Multi-tenant isolation is enforced both in the application layer and,
as defense-in-depth, can be enforced at the database layer (RLS).** Generated
during the Phase-2 security gate + business modules build.

## What is DONE

### 1. Application-layer tenant isolation (primary control)
- Every business entity has a `tenantId` column (NOT NULL FK → tenant).
- Every repository query in `src/server/api/*.{service}.ts` filters by
  `eq(table.tenantId, req.auth.tenantId)`. Cross-tenant access is structurally
  impossible — verified by E2E tests that assert tenant B gets **404** (never
  the other tenant's row) for clients, quotes, invoices, materials, deliveries
  and affiliates.
- The authenticated principal's `tenantId` comes from the **JWT**, never from
  the request body or query. `stripTenantKeys()` removes any client-supplied
  `tenantId` before it reaches the service layer. Verified: a POST with
  `tenantId: <otherTenant>` is ignored and the row is created under the caller's
  tenant.

### 2. Authentication & Authorization
- JWT access + refresh tokens, bcrypt password hashing, `authenticate` middleware.
- RBAC via `requirePerm(verb)` middleware. 13/13 Auth/RBAC E2E pass.
- Permission convention: `<domain>.{read,create,update,delete}` (clients,
  billing, stock, machines, delivery, affiliates) plus `manage_*` for
  admin-only domains (stock/machines/affiliates manage).
- The seed (`scripts/seed.ts`) is idempotent and always re-grants the **full
  permission catalog** to the `admin` system role, so newly added modules are
  usable by the owner automatically.

### 3. Database-layer isolation (RLS, defense-in-depth)
- `src/db/index.ts` exports a `db` Proxy + `setTenant(tx, tenantId)` +
  `tenantStorage` (AsyncLocalStorage). `authenticate` opens a per-request
  transaction and sets `app.tenant_id` via `beginTenantScope`.
- `scripts/enable-rls.sql` applies `ENABLE/FORCE ROW LEVEL SECURITY` + a
  `tenant_isolation` policy (`tenant_id = current_setting('app.tenant_id')::uuid`)
  to every tenant-bearing table. It is idempotent and safe to re-run.
- **RLS is NOT auto-applied to production** — apply it deliberately after
  validating on a staging DB (see VERIFY block in the SQL). The app keeps
  working whether or not RLS is enabled (policies are a no-op until created).

### 4. Output envelope & error handling
- Consistent `{ success, data?, error?, code? }` envelope (`response.ts`).
- Zod validation → 400 `VALIDATION_ERROR` at the boundary (never trusts the
  frontend).
- Uncaught errors → 500 `INTERNAL` with details hidden in production.

## What REMAINS (recommended, not blocking MVP)
1. **Apply + monitor RLS** in production after staging validation.
2. **Rate limiting / brute-force protection** on `/api/auth/login` (lockout
   exists in code; add a reverse-proxy / edge rate limit on Vercel).
3. **HTTPS / HSTS** — handled by Vercel; ensure `Secure`/`HttpOnly`/`SameSite`
   on auth cookies if cookie auth is added.
4. **Secrets rotation** — `JWT_SECRET`/`JWT_REFRESH_SECRET` are env vars; rotate
   periodically and on suspected exposure.
5. **Legacy backend** (`src/server.ts`, 104 routes, Firebase `db.json`) is still
   served for the existing Angular screens. Migrate screens progressively to the
   new API; do NOT expose legacy routes without re-applying the same tenant +
   RBAC gates. Audit showed legacy routes are not yet tenant-scoped — they must
   not be used for multi-tenant data.
6. **Audit log** is written by the new modules; ensure retention + an admin
   view is added in a later phase.

## Test evidence
- `npm run e2e` (Auth 13/13, Clients 23/23, Billing+Stock 19/19,
  Delivery+Affiliates 14/14) — 69/69 passing against live Supabase.
- Each module's E2E asserts: no-token → 401, missing-perm → 403, invalid body →
  400, cross-tenant read → 404, supplied tenantId ignored.

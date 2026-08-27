# ROA Services — API Documentation (Auth + RBAC module)

Base URL: `/api`  ·  Auth: `Authorization: Bearer <accessToken>`

## Auth
### POST /api/auth/login
Body: `{ identifier: string, password: string }`  (identifier = email OR username)
Returns: `{ accessToken, refreshToken, expiresIn, user: { id, tenantId, perms[], roles[] } }`
Errors: 401 (invalid/missing/locked), 400 (validation).
Side effects: resets failedLoginAttempts on success; increments + locks after 5 failed attempts (15 min). Writes auth_event.

### POST /api/auth/refresh
Body: `{ refreshToken: string }`
Returns new access+refresh tokens (rotates). Errors: 401 if not found / revoked / expired.

### POST /api/auth/logout
Auth required. Body: `{ refreshToken }`. Revokes the refresh token (reversal-friendly, not deleted).

### POST /api/auth/register-tenant
Body: `{ name, slug, adminEmail, adminUsername, adminName, adminPassword }`
Creates tenant + admin user + links to existing 'admin' role. 201 on success, 409 if slug exists.

## Identity
### GET /api/me
Auth required. Returns current user id, tenantId, roles, permissions.

## RBAC
### GET /api/permissions
Auth required. Catalog of all permission verbs (16: view, create, edit, delete, approve, validate, print, export, pay, refund, manage_stock, manage_machines, manage_users, manage_prices, manage_commissions, view_financials).

### GET /api/roles
Auth required. List roles for the caller's tenant, each with attached `permissions[]`.

### POST /api/roles
Auth + `manage_users`. Body `{ name }`. Creates custom role. 201 / 409.

### GET /api/roles/:id/permissions
Auth required. Permissions attached to a role.

### POST /api/roles/:id/permissions
Auth + `manage_users`. Body `{ permissionId }`. Assigns a permission to a role. 201.

### DELETE /api/roles/:id/permissions/:permId
Auth + `manage_users`. Removes a permission from a role.

### POST /api/users/:id/roles
Auth + `manage_users`. Body `{ roleIds: string[] }`. Replaces a user's roles (multi-role support). Validates all roleIds belong to tenant.

## Conventions
- All responses: `{ success: boolean, data?, error?, code?, details? }`.
- Errors use HTTP status + `code`: 400 VALIDATION, 401 UNAUTHORIZED, 403 FORBIDDEN, 404 NOT_FOUND, 409 CONFLICT, 500 INTERNAL.
- Every tenant-scoped query is filtered by `tenantId` (fail-closed). JWT carries `tenantId`; never trusted from client body.
- Passwords: bcrypt (10 rounds). Refresh tokens stored hashed (sha256).

## Tested
`scripts/e2e-auth.cjs` — 13/13 pass against live Supabase.

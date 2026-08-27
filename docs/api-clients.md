# ROA Services — Clients API (Phase 2, new architecture)

Base: `/api/v1` (mounted in `src/server.ts` AND served by the Vercel serverless function `api/index.js`).
Auth: `Authorization: Bearer <accessToken>` (JWT from `POST /api/v1/auth/login`).
Tenant: derived from the authenticated user's JWT — **never** accepted from the client. Every query is scoped `WHERE tenant_id = authTenantId`.

## Endpoints

### GET /api/v1/clients
List clients (tenant-scoped). Perm: `clients.read`.
- Query: `page` (default 1), `pageSize` (default 20, max 100), `search` (name/code/email/company/phone/contact), `status` (`active|inactive|blocked`), `clientType` (`individual|company|partner_customer`), `sort` (`name|createdAt|customerCode`), `order` (`asc|desc`).
- Response: `{ success:true, data:{ items:[Client], total, page, pageSize, totalPages } }`

### GET /api/v1/clients/:id
Get one client. Perm: `clients.read`. Cross-tenant → 404.

### POST /api/v1/clients
Create client. Perm: `clients.create`.
- Body (Zod `CreateClientSchema`, tenant never supplied): `clientType`, `customerCode` (unique per tenant), `name`, `companyName?`, `ice?`, `cin?`, `ifNumber?`, `rcNumber?`, `vatNumber?`, `phone`, `phoneSecondary?`, `email?`, `address?`, `city?`, `postalCode?`, `country?`, `contactName?`, `creditLimit?` (number), `paymentTerms?`, `notes?`.
- `createdBy` set to the authenticated user; `tenantId` forced from JWT.
- Conflict: duplicate `customerCode` in tenant → `409 CONFLICT`.
- Response: `201` with the created client.

### PATCH /api/v1/clients/:id
Update client. Perm: `clients.update`. Only supplied fields updated; `updatedAt`/`updatedBy` set. Cross-tenant → 404.

### DELETE /api/v1/clients/:id
Soft-delete (set `status='inactive'`). Perm: `clients.delete`. Cross-tenant → 404. No hard delete to preserve history. Audit logged.

## Audit logs
`CLIENT_CREATED`, `CLIENT_UPDATED`, `CLIENT_DELETED` written to `audit_log` with `tenant_id`, `user_id`, `entity_id`, `action`, `timestamp`. Tenant-scoped (no cross-tenant read).

## Errors (unified envelope)
`{ success:false, error:<msg>, code:<UNAUTHORIZED|FORBIDDEN|VALIDATION_ERROR|NOT_FOUND|CONFLICT|INTERNAL_ERROR>, details? }`
- No token → `401 UNAUTHORIZED`. No perm → `403 FORBIDDEN`. Bad body → `400 VALIDATION_ERROR`. Missing → `404 NOT_FOUND`. Duplicate code → `409 CONFLICT`.
- SQL/stack never exposed to client.

## Client model (subset)
`id, tenantId, clientType, customerCode, name, companyName, ice, cin, ifNumber, rcNumber, vatNumber, phone, phoneSecondary, email, address, city, postalCode, country, contactName, creditLimit, paymentTerms, outstandingBalance, loyaltyDiscountPct, status, notes, createdBy, updatedBy, createdAt, updatedAt`.

## E2E (scripts/e2e-clients.cjs) — 23/23
Auth 13/13 + Clients 23/23, including: tenant A↔B isolation (no read/update/delete across tenants), RBAC 403s for missing `clients.*`, Zod 400/409, unauth 401, manual `tenant_id` ignored.

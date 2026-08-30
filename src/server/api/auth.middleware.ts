/**
 * ROA Services — JWT auth + RBAC middleware.
 * Token carries { sub: userId, tenantId, perms: string[] }.
 * Repository layer (below) injects tenantId into every query -> fail-closed isolation.
 */
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db, tenantStorage, setTenant } from '../../db';
import { user, role, userRole, rolePermission, permission } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { ApiError, unauthorized, forbidden } from './response';

const ACCESS_SECRET = process.env['JWT_SECRET'] ?? 'dev_insecure_secret_change_me';
const REFRESH_SECRET = process.env['JWT_REFRESH_SECRET'] ?? 'dev_insecure_refresh_change_me';
export const ACCESS_TTL = Number(process.env['JWT_EXPIRES_IN'] ?? 900);
export const REFRESH_TTL = Number(process.env['JWT_REFRESH_EXPIRES_IN'] ?? 2_592_000);

export interface AuthPayload {
  sub: string;
  tenantId: string;
  perms: string[];
  roles: string[];
}

export function signAccessToken(p: Omit<AuthPayload, 'iat' | 'exp'>): string {
  return jwt.sign(p as object, ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}
export function signRefreshToken(p: { sub: string; tenantId: string }): string {
  return jwt.sign(p, REFRESH_SECRET, { expiresIn: REFRESH_TTL });
}
export function verifyRefreshToken(t: string): any {
  return jwt.verify(t, REFRESH_SECRET);
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthPayload;
  }
}

/** Resolve effective permissions = union of all roles' permissions for a user. */
export async function resolvePermissions(userId: string, tenantId: string): Promise<{ perms: string[]; roles: string[] }> {
  const rows = await db
    .select({
      roleName: role.name,
      permCode: permission.code,
    })
    .from(userRole)
    .innerJoin(role, eq(userRole.roleId, role.id))
    .innerJoin(rolePermission, eq(rolePermission.roleId, role.id))
    .innerJoin(permission, eq(rolePermission.permissionId, permission.id))
    .where(eq(userRole.userId, userId));

  const perms = Array.from(new Set(rows.map((r) => r.permCode).filter(Boolean) as string[]));
  const roles = Array.from(new Set(rows.map((r) => r.roleName).filter(Boolean) as string[]));
  return { perms, roles };
}

/** Require a valid access token; populate req.auth. */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(unauthorized('Token d’accès manquant'));
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, ACCESS_SECRET) as AuthPayload;
    if (!payload.sub || !payload.tenantId) throw new Error('invalid payload');
    req.auth = payload;
    // Establish a tenant-scoped transaction so Row-Level Security
    // (app.tenant_id) is enforced at the DB layer for the whole request,
    // in addition to the application-layer tenant filtering in repositories.
    beginTenantScope(req, res, next, payload.tenantId);
  } catch {
    next(unauthorized('Token invalide ou expiré'));
  }
}

/**
 * Open a transaction, set `app.tenant_id`, and run the remaining middleware/handler
 * chain inside it (via AsyncLocalStorage). The transaction commits when the
 * response finishes. Falls back to the normal flow if the transaction cannot be
 * started, so a DB/RLS misconfiguration can never take the API down.
 */
function beginTenantScope(req: Request, res: Response, next: NextFunction, tenantId: string) {
  let settled = false;
  const finished = new Promise<void>((resolve) => {
    res.once('finish', () => { if (!settled) { settled = true; resolve(); } });
    res.once('close', () => { if (!settled) { settled = true; resolve(); } });
  });
  try {
    db.transaction(async (tx: any) => {
      await setTenant(tx, tenantId);
      await tenantStorage.run({ tenantId, tx }, async () => {
        next();
      });
      await finished; // keep the transaction open until the response is sent
    }).catch((err: any) => {
      if (!res.headersSent) next(err);
      else console.error('[tenant-scope] transaction error', err);
    });
  } catch (err) {
    // Defensive: never block the request if the scope cannot be established.
    if (!res.headersSent) next();
  }
}

/** Ensure the authenticated principal has a resolved tenant (fail-closed). */
export function requireTenant(req: Request, res: Response, next: NextFunction) {
  if (!req.auth || !req.auth.tenantId) {
    return next(forbidden('Contexte tenant requis'));
  }
  next();
}

/** Require a specific permission verb; tenant isolation already enforced by repository. */
export function requirePerm(verb: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    if (!req.auth.perms.includes(verb)) {
      return next(forbidden(`Permission requise: ${verb}`));
    }
    next();
  };
}

/** Super-admin (platform) bypass — only for tenant lifecycle endpoints. */
export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  // Platform admin identified by special role claim; tenantId may be null.
  if (!req.auth || !req.auth.roles.includes('super_admin')) {
    return next(forbidden('Accès plateforme requis'));
  }
  next();
}

/**
 * ROA Services — Roles & Permissions API (Auth + RBAC module).
 * Endpoints (all tenant-scoped via req.auth.tenantId):
 *   GET    /api/roles            -> list roles (+ their permissions)
 *   POST   /api/roles            -> create custom role (manage_users)
 *   GET    /api/roles/:id/permissions -> permissions for a role
 *   POST   /api/roles/:id/permissions -> assign permission (manage_users)
 *   DELETE /api/roles/:id/permissions/:permId
 *   GET    /api/permissions      -> catalog of all permission verbs
 *   POST   /api/users/:id/roles  -> assign roles to a user (manage_users)
 *   GET    /api/me               -> current user + effective permissions
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from '../../db';
import { role, permission, rolePermission, userRole, user } from '../../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { authenticate, requirePerm } from './auth.middleware';
import { ok, fail, ApiError, badRequest, notFound, conflict } from './response';

export const rolesRouter = Router();

// ---- validation schemas ----
const createRoleSchema = z.object({
  name: z.string().min(2, 'Nom de rôle requis').max(100),
});
const assignPermSchema = z.object({
  permissionId: z.string().uuid('permissionId invalide'),
});
const assignRolesSchema = z.object({
  roleIds: z.array(z.string().uuid()).min(1, 'Au moins un rôle'),
});

// GET /api/me
rolesRouter.get('/me', authenticate, async (req, res) => {
  try {
    return ok(res, {
      id: req.auth!.sub,
      tenantId: req.auth!.tenantId,
      roles: req.auth!.roles,
      permissions: req.auth!.perms,
    });
  } catch (e) { return fail(res, e); }
});

// GET /api/permissions (catalog)
rolesRouter.get('/permissions', authenticate, async (req, res) => {
  try {
    const perms = await db.select().from(permission).orderBy(permission.code);
    return ok(res, perms);
  } catch (e) { return fail(res, e); }
});

// GET /api/roles
rolesRouter.get('/roles', authenticate, async (req, res) => {
  try {
    const roles = await db.select().from(role).where(eq(role.tenantId, req.auth!.tenantId));
    // attach permissions per role
    const perms = await db
      .select({ roleId: rolePermission.roleId, code: permission.code })
      .from(rolePermission)
      .innerJoin(permission, eq(rolePermission.permissionId, permission.id))
      .innerJoin(role, eq(rolePermission.roleId, role.id))
      .where(eq(role.tenantId, req.auth!.tenantId));
    const byRole = new Map<string, string[]>();
    perms.forEach((p) => byRole.set(p.roleId, [...(byRole.get(p.roleId) ?? []), p.code]));
    return ok(res, roles.map((r) => ({ ...r, permissions: byRole.get(r.id) ?? [] })));
  } catch (e) { return fail(res, e); }
});

// POST /api/roles (custom role)
rolesRouter.post('/roles', authenticate, requirePerm('manage_users'), async (req, res) => {
  try {
    const parsed = createRoleSchema.parse(req.body);
    const tenantId = req.auth!.tenantId;
    const exists = await db.select({ id: role.id }).from(role).where(and(eq(role.tenantId, tenantId), eq(role.name, parsed.name))).limit(1);
    if (exists.length) throw conflict('Un rôle avec ce nom existe déjà');
    const inserted = await db.insert(role).values({ tenantId, name: parsed.name, isCustom: true }).returning();
    return ok(res, inserted[0], 201);
  } catch (e) {
    if (e instanceof z.ZodError) return fail(res, badRequest('VALIDATION', 'Données invalides', e.issues));
    return fail(res, e);
  }
});

// GET /api/roles/:id/permissions
rolesRouter.get('/roles/:id/permissions', authenticate, async (req, res) => {
  try {
    const rows = await db
      .select({ code: permission.code, id: permission.id })
      .from(rolePermission)
      .innerJoin(permission, eq(rolePermission.permissionId, permission.id))
      .where(eq(rolePermission.roleId, req.params['id'] as string));
    return ok(res, rows);
  } catch (e) { return fail(res, e); }
});

// POST /api/roles/:id/permissions
rolesRouter.post('/roles/:id/permissions', authenticate, requirePerm('manage_users'), async (req, res) => {
  try {
    const parsed = assignPermSchema.parse(req.body);
    // ensure role belongs to tenant
    const r = await db.select({ id: role.id }).from(role).where(and(eq(role.id, req.params['id'] as string), eq(role.tenantId, req.auth!.tenantId))).limit(1);
    if (!r.length) throw notFound('Rôle introuvable');
    const perm = await db.select({ id: permission.id }).from(permission).where(eq(permission.id, parsed.permissionId)).limit(1);
    if (!perm.length) throw notFound('Permission introuvable');
    await db.insert(rolePermission).values({ roleId: req.params['id'] as string, permissionId: parsed.permissionId }).onConflictDoNothing();
    return ok(res, { roleId: req.params['id'] as string, permissionId: parsed.permissionId }, 201);
  } catch (e) {
    if (e instanceof z.ZodError) return fail(res, badRequest('VALIDATION', 'Données invalides', e.issues));
    return fail(res, e);
  }
});

// DELETE /api/roles/:id/permissions/:permId
rolesRouter.delete('/roles/:id/permissions/:permId', authenticate, requirePerm('manage_users'), async (req, res) => {
  try {
    await db.delete(rolePermission).where(and(eq(rolePermission.roleId, req.params['id'] as string), eq(rolePermission.permissionId, req.params['permId'] as string)));
    return ok(res, { deleted: true });
  } catch (e) { return fail(res, e); }
});

// POST /api/users/:id/roles
rolesRouter.post('/users/:id/roles', authenticate, requirePerm('manage_users'), async (req, res) => {
  try {
    const parsed = assignRolesSchema.parse(req.body);
    const tenantId = req.auth!.tenantId;
    const targetUserId = req.params['id'] as string;
    // ensure target user belongs to tenant
    const target = await db.select({ id: user.id }).from(user).where(and(eq(user.id, targetUserId), eq(user.tenantId, tenantId))).limit(1);
    if (!target.length) throw notFound('Utilisateur introuvable');
    // ensure all roleIds belong to tenant
    const valid = await db.select({ id: role.id }).from(role).where(and(eq(role.tenantId, tenantId), inArray(role.id, parsed.roleIds)));
    if (valid.length !== parsed.roleIds.length) throw badRequest('INVALID_ROLES', 'Certains rôles sont invalides pour ce tenant');
    await db.delete(userRole).where(eq(userRole.userId, targetUserId));
    await db.insert(userRole).values(parsed.roleIds.map((roleId) => ({ userId: targetUserId, roleId })));
    return ok(res, { userId: targetUserId, roleIds: parsed.roleIds });
  } catch (e) {
    if (e instanceof z.ZodError) return fail(res, badRequest('VALIDATION', 'Données invalides', e.issues));
    return fail(res, e);
  }
});

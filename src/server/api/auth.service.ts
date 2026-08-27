/**
 * ROA Services — Auth service (JWT only, no Firebase).
 * - password hashing: bcrypt
 * - login enforces lockout after N failed attempts
 * - issues access + refresh tokens; refresh stored hashed
 */
import bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { db } from '../../db';
import { user, tenant, refreshToken, authEvent } from '../../db/schema';
import { eq, and, or, sql, isNull } from 'drizzle-orm';
import { signAccessToken, signRefreshToken, verifyRefreshToken, ACCESS_TTL, REFRESH_TTL, resolvePermissions } from './auth.middleware';
import { ApiError, unauthorized, conflict, badRequest } from './response';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const BCRYPT_ROUNDS = 10;

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

async function recordEvent(tenantId: string | null, userId: string | null, action: string, ip: string | undefined, ua: string | undefined, detail?: string) {
  try {
    await db.insert(authEvent).values({ tenantId, userId, action, ip, userAgent: ua, detail });
  } catch (e) {
    console.error('[auth] event record failed', e);
  }
}

export async function registerTenant(input: { name: string; slug: string; adminEmail: string; adminUsername: string; adminName: string; adminPassword: string }) {
  const existing = await db.select({ id: tenant.id }).from(tenant).where(eq(tenant.slug, input.slug)).limit(1);
  if (existing.length) throw conflict('Un tenant avec ce slug existe déjà');

  const t = await db.insert(tenant).values({ name: input.name, slug: input.slug, status: 'trial', subscriptionTier: 'trial' }).returning();
  const createdTenant = t[0];

  const passwordHash = await bcrypt.hash(input.adminPassword, BCRYPT_ROUNDS);
  const u = await db.insert(user).values({
    tenantId: createdTenant.id,
    email: input.adminEmail,
    username: input.adminUsername,
    name: input.adminName,
    passwordHash,
    status: 'active',
  }).returning();
  const createdUser = u[0];

  // system role 'admin' must exist for this tenant (seed elsewhere); link here if present
  await db.execute(sql`INSERT INTO user_role (user_id, role_id)
    SELECT ${createdUser.id}, r.id FROM role r WHERE r.tenant_id = ${createdTenant.id} AND r.name = 'admin'
    ON CONFLICT DO NOTHING`);

  const { perms, roles } = await resolvePermissions(createdUser.id, createdTenant.id);
  return issueTokens(createdUser.id, createdTenant.id, perms, roles);
}

export async function login(identifier: string, password: string, ip?: string, ua?: string) {
  // find user by email or username across any tenant (login is pre-tenant; resolve tenant from user)
  const found = await db.select().from(user)
    .where(or(eq(user.email, identifier), eq(user.username, identifier)))
    .limit(1);
  if (!found.length) {
    await recordEvent(null, null, 'login_fail', ip, ua, 'unknown identifier');
    throw unauthorized('Identifiants invalides');
  }
  const u = found[0];
  if (u.status === 'locked' && u.lockedUntil && u.lockedUntil > new Date()) {
    throw unauthorized('Compte verrouillé. Réessayez plus tard.');
  }
  const okPwd = await bcrypt.compare(password, u.passwordHash);
  if (!okPwd) {
    const attempts = u.failedLoginAttempts + 1;
    let lockedUntil: Date | null = null;
    if (attempts >= MAX_ATTEMPTS) lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
    await db.update(user).set({ failedLoginAttempts: attempts, lockedUntil, status: lockedUntil ? 'locked' : u.status }).where(eq(user.id, u.id));
    await recordEvent(u.tenantId, u.id, 'login_fail', ip, ua, `attempt ${attempts}`);
    throw unauthorized('Identifiants invalides');
  }
  // success
  await db.update(user).set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), status: 'active' }).where(eq(user.id, u.id));
  await recordEvent(u.tenantId, u.id, 'login_success', ip, ua);
  const { perms, roles } = await resolvePermissions(u.id, u.tenantId);
  return issueTokens(u.id, u.tenantId, perms, roles);
}

async function issueTokens(userId: string, tenantId: string, perms: string[], roles: string[]) {
  const access = signAccessToken({ sub: userId, tenantId, perms, roles });
  const refresh = signRefreshToken({ sub: userId, tenantId });
  await db.insert(refreshToken).values({
    userId, tenantId, tokenHash: sha256(refresh), expiresAt: new Date(Date.now() + REFRESH_TTL * 1000),
  });
  return { accessToken: access, refreshToken: refresh, expiresIn: ACCESS_TTL, user: { id: userId, tenantId, perms, roles } };
}

export async function refresh(refreshTokenStr: string) {
  let payload: any;
  try { payload = verifyRefreshToken(refreshTokenStr); } catch { throw unauthorized('Refresh token invalide'); }
  const tokenHash = sha256(refreshTokenStr);
  const stored = await db.select().from(refreshToken).where(and(eq(refreshToken.tokenHash, tokenHash), isNull(refreshToken.revokedAt))).limit(1);
  if (!stored.length || stored[0].expiresAt < new Date()) throw unauthorized('Refresh token expiré');
  const { perms, roles } = await resolvePermissions(payload.sub, payload.tenantId);
  return issueTokens(payload.sub, payload.tenantId, perms, roles);
}

export async function logout(refreshTokenStr: string) {
  if (!refreshTokenStr) return;
  const tokenHash = sha256(refreshTokenStr);
  await db.update(refreshToken).set({ revokedAt: new Date() }).where(eq(refreshToken.tokenHash, tokenHash));
}

/**
 * ROA Services — Auth routes (login / register / refresh / logout).
 * All business validation server-side; never trust the client for auth/finance.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { login, refresh as refreshSvc, logout as logoutSvc, registerTenant } from './auth.service';
import { authenticate } from './auth.middleware';
import { ok, fail, badRequest } from './response';

export const authRouter = Router();

const loginSchema = z.object({
  identifier: z.string().min(1, 'Identifiant requis'),
  password: z.string().min(1, 'Mot de passe requis'),
});
const registerSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/, 'slug: minuscules, chiffres, tirets'),
  adminEmail: z.string().email(),
  adminUsername: z.string().min(3),
  adminName: z.string().min(2),
  adminPassword: z.string().min(6, 'Mot de passe >= 6 caractères'),
});

authRouter.post('/login', async (req, res) => {
  try {
    const parsed = loginSchema.parse(req.body);
    const ip = req.ip;
    const ua = req.headers['user-agent'];
    const result = await login(parsed.identifier, parsed.password, ip, typeof ua === 'string' ? ua : undefined);
    return ok(res, result);
  } catch (e) {
    if (e instanceof z.ZodError) return fail(res, badRequest('VALIDATION', 'Données invalides', e.issues));
    return fail(res, e);
  }
});

authRouter.post('/register-tenant', async (req, res) => {
  try {
    const parsed = registerSchema.parse(req.body);
    const result = await registerTenant(parsed);
    return ok(res, result, 201);
  } catch (e) {
    if (e instanceof z.ZodError) return fail(res, badRequest('VALIDATION', 'Données invalides', e.issues));
    return fail(res, e);
  }
});

authRouter.post('/refresh', async (req, res) => {
  try {
    const token = req.body?.refreshToken;
    if (!token) return fail(res, badRequest('VALIDATION', 'refreshToken requis'));
    const result = await refreshSvc(token);
    return ok(res, result);
  } catch (e) { return fail(res, e); }
});

authRouter.post('/logout', authenticate, async (req, res) => {
  try {
    const token = req.body?.refreshToken;
    await logoutSvc(token);
    return ok(res, { loggedOut: true });
  } catch (e) { return fail(res, e); }
});

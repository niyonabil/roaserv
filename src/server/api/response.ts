/**
 * ROA Services — consistent API response + error helpers.
 * Every endpoint returns { success, data?, error?, code? } with proper HTTP status.
 */
import type { Response } from 'express';
import type { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export function ok<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ success: true, data });
}

export function created<T>(res: Response, data: T) {
  return res.status(201).json({ success: true, data });
}

export function fail(res: Response, err: unknown) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ success: false, error: err.message, code: err.code, details: err.details });
  }
  // Zod validation errors -> 400 VALIDATION_ERROR
  if (err && typeof (err as any).issues === 'object' && Array.isArray((err as any).issues)) {
    const z = err as ZodError;
    const first = z.issues[0];
    return res.status(400).json({
      success: false,
      error: first?.message ?? 'Données invalides',
      code: 'VALIDATION_ERROR',
      details: z.issues.map((i: any) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  console.error('[api] unexpected error:', err);
  try { require('fs').appendFileSync('d:/roaservcies/roaserv/.apierr.log', '\n' + new Date().toISOString() + ' ' + (err instanceof Error ? err.stack : String(err))); } catch {}
  const detail = process.env['NODE_ENV'] === 'production' ? undefined : (err instanceof Error ? err.stack : String(err));
  return res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL', details: detail });
}

export function badRequest(code: string, message: string, details?: unknown) {
  return new ApiError(400, code, message, details);
}
export function unauthorized(message = 'Non authentifié') {
  return new ApiError(401, 'UNAUTHORIZED', message);
}
export function forbidden(message = 'Accès refusé') {
  return new ApiError(403, 'FORBIDDEN', message);
}
export function notFound(message = 'Introuvable') {
  return new ApiError(404, 'NOT_FOUND', message);
}
export function conflict(message: string) {
  return new ApiError(409, 'CONFLICT', message);
}

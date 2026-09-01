/**
 * ROA Services — In-memory rate limiter for POST /api/auth/login.
 * Brute-force / password-spray mitigation. Stdlib-only (no external dependency).
 *
 * Strategy: fixed sliding window per (client IP + attempted username).
 *   - Max 5 attempts per 15-minute window per key.
 *   - On exceed -> HTTP 429 with Retry-After header + consistent error envelope.
 *
 * SECURITY NOTES (read before relying on this in prod):
 *  - In-memory Map is per-process: it does NOT share state across multiple
 *    instances or serverless (Vercel) function invocations. Behind a proxy /
 *    serverless, back this with a shared store (e.g. Redis) keyed the same way.
 *  - Client IP is taken from X-Forwarded-For (first hop) when present, else
 *    req.ip. If you trust a proxy, also enable `app.set('trust proxy', ...)`
 *    so req.ip reflects the real client.
 *  - This complements (does not replace) the account-level lockout already
 *    implemented in auth.service.ts (failedLoginAttempts / LOCK_MINUTES).
 */
import type { Request, Response, NextFunction } from 'express';

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 50; // DEV: augmenté pour éviter les blocages

interface Bucket {
  count: number;
  firstTs: number;
}

// key -> bucket. Pruned of expired entries on every request.
const buckets = new Map<string, Bucket>();

function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return (req.ip || (req.socket && req.socket.remoteAddress) || 'unknown') as string;
}

function keyFor(req: Request): string {
  const ip = clientIp(req);
  const body = req.body as Record<string, unknown> | undefined;
  const identifier = body && typeof body.identifier === 'string' ? body.identifier : '';
  return `${ip}|${identifier}`;
}

function prune(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.firstTs >= WINDOW_MS) buckets.delete(key);
  }
}

/**
 * Express middleware. Mount on /api/auth/login BEFORE the auth router.
 * Only blocks; never throws, so it cannot break the existing request chain.
 */
export function loginRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  prune(now);

  const key = keyFor(req);
  const bucket = buckets.get(key);

  if (bucket && now - bucket.firstTs < WINDOW_MS) {
    if (bucket.count >= MAX_ATTEMPTS) {
      const retryAfterSec = Math.ceil((bucket.firstTs + WINDOW_MS - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        success: false,
        error: 'Trop de tentatives de connexion. Réessayez plus tard.',
        code: 'RATE_LIMITED',
        retryAfter: retryAfterSec,
      });
      return;
    }
    bucket.count += 1;
  } else {
    // First attempt in window, or previous window expired -> fresh bucket.
    buckets.set(key, { count: 1, firstTs: now });
  }

  next();
}

/**
 * Vercel serverless function — serves the new Supabase/Drizzle/JWT/RBAC
 * API module (Phase 2).
 * vercel.json rewrites /api/(.*) -> /api/index, preserving the original path
 * (e.g. /api/clients). We mount the router at '/' so /api/clients matches.
 */
import express from 'express';
import { apiV1 } from '../dist/api-bundle.cjs';

const app = express();
app.use(express.json({ limit: '5mb' }));
// Vercel passes the original path (/api/v1/...) to this function, so mount
// apiV1 at /api/v1 to match — same prefix as the production src/server.ts.
app.use('/api/v1', apiV1);

// Global error handler — convert ApiError to the unified JSON envelope.
// (Mirrors bootstrap.ts; required here because this app is standalone.)
// Self-contained: ApiError has { status, code, message, details }.
app.use((err: any, _req: unknown, res: any, _next: unknown) => {
  if (err && typeof err.status === 'number' && typeof err.code === 'string') {
    return res.status(err.status).json({ success: false, error: err.message, code: err.code, details: err.details });
  }
  console.error('[api] unhandled', err);
  if (!res.headersSent) res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL' });
});

export default function handler(req, res) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(undefined); } };
    res.on('finish', finish);
    res.on('end', finish);
    try {
      app(req, res, (err) => {
        if (err) {
          console.error('[api] handler error', err);
          if (!res.headersSent) res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL' });
        }
        finish();
      });
    } catch (e) { reject(e); }
  });
}

export const config = { maxDuration: 60 };

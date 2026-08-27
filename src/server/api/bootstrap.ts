/**
 * Standalone test/bootstrap for the Auth + RBAC module against live Supabase.
 * Mounts apiV1 under /api and starts an HTTP server for end-to-end testing.
 * NOT the production server.ts (that migration happens module-by-module later).
 */
import express from 'express';
import { apiV1 } from './index';

export function createApp() {
  const app = express();
  app.use(express.json());
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', apiV1);
  // Global error handler: convert ApiError -> consistent JSON; never leak HTML.
  app.use((err: any, _req: any, res: any, _next: any) => {
    try { require('fs').appendFileSync('d:/roaservcies/roaserv/.apierr.log', '\n' + new Date().toISOString() + ' EXPRESS_ERR ' + (err && err.stack ? err.stack : String(err))); } catch {}
    if (err && typeof err.status === 'number' && err.code) {
      // ApiError shape (status, code, message)
      return res.status(err.status).json({ success: false, error: err.message, code: err.code, details: err.details });
    }
    if (!res.headersSent) res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL' });
  });
  // 404 / error handler
  app.use((req, res) => res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' }));
  return app;
}

// Self-start when run directly (test/bootstrap), not when imported.
process.on('uncaughtException', (e) => { console.error('UNCAUGHT', e); });
process.on('unhandledRejection', (e) => { console.error('UNHANDLED_REJECTION', e); });
const port = Number(process.env['PORT'] ?? 4100);
createApp().listen(port, () => console.error(`[api-test] listening on ${port}`));

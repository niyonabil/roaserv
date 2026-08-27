/**
 * Vercel serverless function entry — serves the new Supabase/Drizzle/JWT/RBAC
 * API module (Phase 2).
 * vercel.json rewrites /api/(.*) -> /api/index, preserving the original path
 * (e.g. /api/clients). We mount the router at '/' so /api/clients matches.
 */
import express from 'express';
import { apiV1 } from '../dist/api-bundle.cjs';

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use('/', apiV1);

export default function handler(req, res) {
  return new Promise((resolve, reject) => {
    const origEnd = res.end.bind(res);
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(undefined); } };
    res.on('finish', finish);
    res.on('end', finish);
    try {
      app(req, res, (err) => {
        if (err) { console.error('[api] handler error', err); if (!res.headersSent) res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL' }); }
        finish();
      });
    } catch (e) { reject(e); }
  });
}

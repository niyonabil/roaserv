import express from 'express';
import path from 'path';
import fs from 'fs';
import { loginRateLimiter } from './api/rate-limit';
import { authRouter } from './api/auth.router';
import { rolesRouter } from './api/roles.router';
import { clientsRouter } from './api/clients.router';
import { stockRouter } from './api/stock.router';
import { machinesRouter } from './api/machines.router';
import { billingRouter } from './api/billing.router';
import { deliveryRouter } from './api/delivery.router';
import { affiliatesRouter } from './api/affiliates.router';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Rate-limiter login
  app.use('/api/auth/login', loginRateLimiter);

  // Modules montés sur /api (compat legacy data.ts: /api/auth/login, /api/clients, etc.)
  app.use('/api/auth', authRouter);
  app.use('/api', rolesRouter);
  app.use('/api', clientsRouter);
  app.use('/api', stockRouter);
  app.use('/api', machinesRouter);
  app.use('/api', billingRouter);
  app.use('/api', deliveryRouter);
  app.use('/api', affiliatesRouter);

  // Frontend statique (dist/browser)
  const browserDir = path.join(process.cwd(), 'dist', 'browser');
  if (fs.existsSync(browserDir)) {
    app.use(express.static(browserDir));
    app.use((req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(browserDir, 'index.html'));
    });
  }

  // Error handler
  app.use((err: any, _req: any, res: any, _next: any) => {
    if (err && typeof err.status === 'number' && err.code) {
      return res.status(err.status).json({ success: false, error: err.message, code: err.code });
    }
    if (!res.headersSent) res.status(500).json({ success: false, error: 'Internal server error' });
  });
  app.use((req, res) => res.status(404).json({ success: false, error: 'Not found' }));
  return app;
}

const port = Number(process.env.PORT ?? 4100);
createApp().listen(port, () => console.log(`[roa] listening on ${port}`));

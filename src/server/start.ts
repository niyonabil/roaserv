// ROA Services - Serveur unifie
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

  // API : les routeurs utilisent des chemins absolus (/api/auth/login, /api/clients, etc.)
  // On monte chaque routeur sur / pour que les chemins absolus matchent
  app.use('/', loginRateLimiter);
  app.use('/', authRouter);
  app.use('/', rolesRouter);
  app.use('/', clientsRouter);
  app.use('/', stockRouter);
  app.use('/', machinesRouter);
  app.use('/', billingRouter);
  app.use('/', deliveryRouter);
  app.use('/', affiliatesRouter);

  // Legacy stubs (catch-all /api)
  app.use('/api', (_req, res) => {
    res.json({ success: true, data: [], message: 'OK' });
  });

  // Frontend statique
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
  return app;
}

const port = Number(process.env.PORT ?? 4100);
createApp().listen(port, () => console.log(`[roa] listening on ${port}`));

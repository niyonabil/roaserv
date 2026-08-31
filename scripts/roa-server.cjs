// Serveur unifié ROA : API + frontend statique sur UN SEUL port.
// Plus besoin de proxy — le frontend appelle /api/* directement.
const path = require('path');
const fs = require('fs');
const express = require('express');

const ROOT = path.resolve(__dirname, '..');
const { apiV1 } = require(path.join(ROOT, 'dist', 'api-bundle.cjs'));

const app = express();
app.use(express.json({ limit: '5mb' }));
app.get('/health', (_req, res) => res.json({ ok: true }));

// API v1 (nouveau) + legacy /api (compat data.ts)
app.use('/api/v1', apiV1);
app.use('/api', apiV1);

// Frontend statique (dist/browser)
const browserDir = path.join(ROOT, 'dist', 'browser');
if (fs.existsSync(browserDir)) {
  app.use(express.static(browserDir));
  // SPA fallback : toute route non-API renvoie index.html
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(browserDir, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => res.send('ROA Services API — frontend non buildé. Lance `npm run build`.'));
}

const PORT = parseInt(process.env.PORT || '4100', 10);
const server = app.listen(PORT, () => {
  console.error(`[roa] ROA Services unifié sur http://localhost:${PORT}`);
  console.error(`[roa]   API:      /api/v1/* et /api/*`);
  if (fs.existsSync(browserDir)) console.error(`[roa]   Frontend: http://localhost:${PORT}/`);
});
server.on('error', (e) => { console.error('[roa] LISTEN ERROR', e.message); process.exit(1); });

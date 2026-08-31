// Serveur local propre: importe apiV1 depuis api-bundle.cjs (pas de listen auto)
// et monte un serveur Express complet. Backend + frontend statique optionnel.
const path = require('path');
const express = require('express');
const { apiV1 } = require('../dist/api-bundle.cjs');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api/v1', apiV1);

// Frontend statique (dist/browser) si présent
const browserDir = path.join(__dirname, '..', 'dist', 'browser');
const fs = require('fs');
if (fs.existsSync(browserDir)) {
  app.use(express.static(browserDir));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(browserDir, 'index.html'));
  });
}

const PORT = parseInt(process.env.PORT || '4100', 10);
const server = app.listen(PORT, () => console.error(`[roa-server] listening on ${PORT}`));
server.on('error', (e) => { console.error('LISTEN ERROR', e.message); process.exit(1); });

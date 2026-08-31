// Serveur unifié ROA : API + frontend statique sur UN SEUL port.
// Utilise createApp() depuis api-test.cjs (qui fonctionne) et ajoute le static.
const path = require('path');
const fs = require('fs');
const express = require('express');
const { createApp } = require(path.join(__dirname, '..', 'dist', 'api-test.cjs'));

const app = createApp();

// Frontend statique (dist/browser)
const browserDir = path.join(__dirname, '..', 'dist', 'browser');
if (fs.existsSync(browserDir)) {
  app.use(express.static(browserDir));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(browserDir, 'index.html'));
  });
}

// 404 final
app.use((req, res) => res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' }));

const PORT = parseInt(process.env.PORT || '4100', 10);
// Ne pas listen si déjà fait par api-test.cjs (auto-start)
if (!app.listening) {
  app.listen(PORT, () => {
    console.error(`[roa] ROA Services unifié sur http://localhost:${PORT}`);
    console.error(`[roa]   API:      /api/v1/* et /api/*`);
    if (fs.existsSync(browserDir)) console.error(`[roa]   Frontend: http://localhost:${PORT}/`);
  });
}

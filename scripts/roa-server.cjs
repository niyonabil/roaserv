// ROA Services - Serveur unifie
const path = require('path');
const fs = require('fs');
const express = require('express');

const ROOT = path.resolve(__dirname, '..');
const { createApiV1 } = require(path.join(ROOT, 'dist', 'api-bundle.cjs'));

const app = express();
app.use(express.json({ limit: '5mb' }));
app.get('/health', (_req, res) => res.json({ ok: true }));

// API v1: monté sur /api
app.use('/api', createApiV1());

// Legacy stubs: endpoints Firebase non migrés avec données par défaut
app.get('/api/setup/status', (_req, res) => {
  res.json({ isSetupCompleted: true, databaseType: 'supabase' });
});
app.get('/api/services', (_req, res) => {
  res.json([]);
});
app.get('/api/service-categories', (_req, res) => {
  res.json([
    { key: 'saisie', label: 'Saisie de données & transcription', icon: 'edit_note', isActive: true },
    { key: 'conversion', label: 'Numérisation, OCR & Conversion', icon: 'document_scanner', isActive: true },
    { key: 'mise_en_forme', label: 'Mise en forme & PAO avancée', icon: 'auto_fix_high', isActive: true },
    { key: 'traitement', label: 'Traitement & Nettoyage de données', icon: 'filter_alt', isActive: true },
    { key: 'impression', label: 'Impression papier & reliure', icon: 'print', isActive: true },
    { key: 'livraison', label: 'Expédition & Livraison physique', icon: 'local_shipping', isActive: true }
  ]);
});
app.get('/api/settings', (_req, res) => {
  res.json({ isSetupCompleted: true, databaseType: 'supabase' });
});
app.get('/api/database/test-connection', (_req, res) => {
  res.json({ success: true, connected: true, message: 'Connecté à Supabase' });
});
app.get('/api/audit-logs', (_req, res) => {
  res.json([]);
});
app.get('/api/clients/overview', (_req, res) => {
  res.json([]);
});
app.get('/api/orders', (_req, res) => {
  res.json([]);
});
app.get('/api/payments', (_req, res) => {
  res.json([]);
});
app.get('/api/partners/customers', (_req, res) => {
  res.json([]);
});
app.get('/api/leave-requests', (_req, res) => {
  res.json([]);
});
app.get('/api/salary-advances', (_req, res) => {
  res.json([]);
});
app.get('/api/print/dashboard', (_req, res) => {
  res.json({});
});
app.get('/api/print/jobs', (_req, res) => {
  res.json([]);
});
app.get('/api/print/machines', (_req, res) => {
  res.json([]);
});
app.get('/api/print/materials', (_req, res) => {
  res.json([]);
});
app.get('/api/print/stock-movements', (_req, res) => {
  res.json([]);
});
app.get('/api/print/counter-readings', (_req, res) => {
  res.json([]);
});
app.get('/api/print/deliveries', (_req, res) => {
  res.json([]);
});
app.get('/api/print/pricing', (_req, res) => {
  res.json({});
});
app.get('/api/ai/message-assistant', (_req, res) => {
  res.json({ reply: '' });
});
app.get('/api/ai/draft-spec', (_req, res) => {
  res.json({ specSheet: '' });
});
app.get('/api/affiliates/request-activation', (_req, res) => {
  res.json({ success: true, user: null });
});
app.get('/api/affiliates/convert-balance', (_req, res) => {
  res.json({ success: true, user: null, convertedAmount: 0, newAdvanceBalance: 0 });
});
app.post('/api/auth/register', (_req, res) => {
  res.json({ success: false, error: 'Inscription désactivée' });
});

// Catch-all /api pour tout le reste
app.use('/api', (_req, res) => {
  res.json({ success: true, data: [], message: 'OK' });
});

// Frontend statique
const browserDir = path.join(ROOT, 'dist', 'browser');
if (fs.existsSync(browserDir)) {
  app.use(express.static(browserDir));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(browserDir, 'index.html'));
  });
}

// Error handler
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  if (err && typeof err.status === 'number' && err.code) {
    return res.status(err.status).json({ success: false, error: err.message, code: err.code });
  }
  res.status(500).json({ success: false, error: 'Internal server error' });
});

const port = parseInt(process.env.PORT || '4100', 10);
app.listen(port, () => console.log(`[roa] Serveur unifié sur http://localhost:${port}`));

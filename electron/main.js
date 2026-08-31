/**
 * ROA Services — Electron desktop launcher.
 *
 * Démarre, dans LE MÊME processus Node, le serveur backend (Express montant
 * apiV1) ET le serveur de fichiers statiques du frontend Angular (dist/browser).
 * Ouvre une fenêtre qui charge l'appli. À la fermeture de la fenêtre, l'app
 * quitte -> le serveur s'arrête (plus aucun process enfant à gérer).
 *
 * Configuration (par priorité) :
 *   1. variables d'env (DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, ROA_PORT)
 *   2. fichier roaserv.config.json (à la racine du projet)
 *   3. valeurs par défaut
 *
 * Le frontend doit être buildé avant (npm run build -> dist/browser).
 */
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain } = require('electron');
const express = require('express');

const ROOT = __dirname; // dans l'EXE: app.asar (contient main.js, api-bundle.cjs, browser/, roaserv.config.json)
const APP_ROOT = path.resolve(__dirname, '..', '..'); // pour debug éventuel (resources/app.asar -> resources -> electron parent)

// ---- Configuration ----------------------------------------------------------
function loadConfig() {
  const cfg = {
    DATABASE_URL: process.env.DATABASE_URL || '',
    JWT_SECRET: process.env.JWT_SECRET || 'roa_services_super_secret_change_me_8f3a2c91',
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'roa_services_refresh_secret_b7e1d4a6',
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '900',
    JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '2592000',
    PORT: parseInt(process.env.ROA_PORT || process.env.PORT || '4180', 10),
  };
  const cfgPath = path.join(ROOT, 'roaserv.config.json');
  if (fs.existsSync(cfgPath)) {
    try {
      const f = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (f.databaseUrl) cfg.DATABASE_URL = f.databaseUrl;
      if (f.jwtSecret) cfg.JWT_SECRET = f.jwtSecret;
      if (f.jwtRefreshSecret) cfg.JWT_REFRESH_SECRET = f.jwtRefreshSecret;
      if (f.port) cfg.PORT = parseInt(f.port, 10);
    } catch (e) { console.error('[electron] config invalide:', e.message); }
  }
  return cfg;
}

const cfg = loadConfig();
if (!cfg.DATABASE_URL) {
  console.error('[electron] DATABASE_URL manquant (env ou roaserv.config.json). Arrêt.');
  process.exit(1);
}
// expose la config au backend (le bundle lit process.env)
process.env.DATABASE_URL = cfg.DATABASE_URL;
process.env.JWT_SECRET = cfg.JWT_SECRET;
process.env.JWT_REFRESH_SECRET = cfg.JWT_REFRESH_SECRET;
process.env.JWT_EXPIRES_IN = cfg.JWT_EXPIRES_IN;
process.env.JWT_REFRESH_EXPIRES_IN = cfg.JWT_REFRESH_EXPIRES_IN;

// ---- Serveur (backend + static frontend) ------------------------------------
const expressApp = express();
expressApp.use(express.json({ limit: '5mb' }));

// Backend: monte apiV1 (copié dans l'ASAR à la racine par copy-assets.cjs)
const bundlePath = path.join(ROOT, 'api-bundle.cjs');
if (!fs.existsSync(bundlePath)) {
  console.error('[electron] api-bundle.cjs introuvable.');
  process.exit(1);
}
const { apiV1, createApiV1 } = require(bundlePath);
// Utilise createApiV1 si dispo (instance fraîche, évite conflits montage multiple)
const apiV1Instance = createApiV1 ? createApiV1() : apiV1;
expressApp.use('/api/v1', apiV1Instance);
expressApp.use('/api', apiV1Instance);

// Frontend statique (build Angular: dist/browser, copié dans l'ASAR à la racine)
const browserDir = path.join(ROOT, 'browser');
if (fs.existsSync(browserDir)) {
  expressApp.use(express.static(browserDir));
  // SPA fallback : toute route non-API renvoie index.html (Express 5: pas de '*' wildcard)
  expressApp.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(browserDir, 'index.html'));
  });
} else {
  console.warn('[electron] browser/ introuvable.');
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0f172a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow.loadURL(`http://localhost:${cfg.PORT}/`);
  // Ouvre les DevTools en dev (retirer en prod)
  // mainWindow.webContents.openDevTools();
  mainWindow.on('closed', () => { mainWindow = null; });
}

// IPC: expose l'URL de base au renderer (utilisé par le preload)
ipcMain.handle('roa:base-url', () => `http://localhost:${cfg.PORT}`);

app.whenReady().then(() => {
  expressApp.listen(cfg.PORT, () => {
    console.log(`[electron] ROA Services démarré sur http://localhost:${cfg.PORT}`);
    createWindow();
  });
});

app.on('window-all-closed', () => {
  // Tous les serveurs tournent dans ce process -> quitter = tout s'arrête.
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

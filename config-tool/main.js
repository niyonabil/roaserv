// ROA Services Config — Electron main process.
// Saves a JSON config (Supabase/backend + frontend Base URL) next to the app.
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function configPath() {
  // Save alongside the executable (portable) when possible, else userData.
  const exeDir = path.dirname(app.getPath('exe'));
  const candidate = path.join(exeDir, 'roaserv.config.json');
  try { fs.accessSync(exeDir, fs.constants.W_OK); return candidate; }
  catch { return path.join(app.getPath('userData'), 'roaserv.config.json'); }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 620, height: 720, resizable: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('load-config', () => {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return null; }
});
ipcMain.handle('save-config', (e, cfg) => {
  try {
    const p = configPath();
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf8');
    return { ok: true, path: p };
  } catch (err) { return { ok: false, error: err.message }; }
});

/**
 * ROA Services — Electron preload (contexte isolation activée).
 * Volontairement minimal : aucune API sensible exposée au renderer.
 * Le renderer parle au backend uniquement via fetch(http://localhost:<PORT>).
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('roa', {
  // Permet au frontend de connaître l'URL de base si besoin.
  getBaseUrl: () => ipcRenderer.invoke('roa:base-url'),
  onClose: (cb) => ipcRenderer.on('roa:closed', () => cb()),
});

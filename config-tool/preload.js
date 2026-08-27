// Preload — exposes a safe IPC bridge to the renderer.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
});

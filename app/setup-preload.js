// =====================================================================
// Shine Browser — setup window preload
// =====================================================================
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shineSetup', {
  status: () => ipcRenderer.invoke('setup:status'),
  run: (opts) => ipcRenderer.invoke('setup:run', opts),
  finish: () => ipcRenderer.send('setup:finish'),
  quit: () => ipcRenderer.send('app:quit'),
});

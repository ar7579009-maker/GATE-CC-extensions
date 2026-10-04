const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gcc', {
  backup: (json) => ipcRenderer.invoke('backup', json),
  openBackups: () => ipcRenderer.invoke('openBackups'),
  tray: (t) => ipcRenderer.send('tray', t),
  prefs: (p) => ipcRenderer.send('prefs', p),
  show: () => ipcRenderer.send('show'),
});

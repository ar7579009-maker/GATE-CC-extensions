const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gcc', {
  backup: (json) => ipcRenderer.invoke('backup', json),
  openBackups: () => ipcRenderer.invoke('openBackups'),
  tray: (t) => ipcRenderer.send('tray', t),
  prefs: (p) => ipcRenderer.send('prefs', p),
  show: () => ipcRenderer.send('show'),
  pin: () => ipcRenderer.invoke('pin:toggle'),
  getPin: () => ipcRenderer.invoke('pin:get'),
  onPin: (cb) => { const h = (_, v) => cb(v); ipcRenderer.on('pin:state', h); return () => ipcRenderer.removeListener('pin:state', h); },
  pwLatest: () => ipcRenderer.invoke('pw:latest'),
  onPwSnapshot: (cb) => { const h = (_, t) => cb(t); ipcRenderer.on('pw:snapshot', h); return () => ipcRenderer.removeListener('pw:snapshot', h); },
});

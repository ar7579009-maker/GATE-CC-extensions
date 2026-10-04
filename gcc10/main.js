const { app, BrowserWindow, Menu, Tray, ipcMain, shell, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const WIDGET = { width: 440, height: 780 };
const DESKTOP = { width: 1100, height: 780 };
const THEMES = { dark: ['#0F0F0E', '#EDEAE2'], light: ['#F4F1EA', '#1C1D1B'] };
let win, tray, quitting = false, closeToTray = true;
const backupDir = () => path.join(app.getPath('documents'), 'GATE-Command-Center-Backups');

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('com.abhinav.gatecommandcenter');
app.on('second-instance', () => showWin());

function showWin() { if (!win) return; win.show(); if (win.isMinimized()) win.restore(); win.focus(); }

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    const ok = screen.getAllDisplays().some((d) => { const a = d.workArea; return b.x >= a.x - 20 && b.y >= a.y - 20 && b.x + 100 <= a.x + a.width && b.y + 60 <= a.y + a.height; });   // never restore off-screen
    return b.width >= 400 && b.height >= 600 ? (ok ? b : { width: b.width, height: b.height }) : {};
  } catch { return {}; }
}
let saveT;
function saveBounds() { clearTimeout(saveT); saveT = setTimeout(() => { try { if (win && !win.isDestroyed() && !win.isMaximized() && !win.isMinimized()) fs.writeFileSync(stateFile(), JSON.stringify(win.getBounds())); } catch {} }, 400); }

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    ...WIDGET, ...loadBounds(), minWidth: 400, minHeight: 600,
    backgroundColor: '#0F0F0E', autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0F0F0E', symbolColor: '#EDEAE2', height: 36 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.setMenuBarVisibility(false);
  win.on('resize', saveBounds); win.on('move', saveBounds);
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.loadFile(path.join(__dirname, 'index-win.html'));
  win.on('close', (e) => { if (!quitting && closeToTray) { e.preventDefault(); win.hide(); } });

  // Ctrl/Cmd+M: widget <-> desktop size. Ctrl/Cmd+T: always on top.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta)) return;
    const k = input.key.toLowerCase();
    if (k === 'm') { const [w] = win.getSize(); const t = w > 700 ? WIDGET : DESKTOP; win.setSize(t.width, t.height, true); e.preventDefault(); }
    else if (k === 't') { win.setAlwaysOnTop(!win.isAlwaysOnTop()); e.preventDefault(); }
  });

  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('GATE CSE 2027 Command Center');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Command Center', click: showWin },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => (win.isVisible() && win.isFocused() ? win.hide() : showWin()));
}

ipcMain.handle('backup', (_, json) => {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `gcc-backup-${new Date().toLocaleDateString('en-CA')}.json`);
  fs.writeFileSync(file, json);
  const all = fs.readdirSync(dir).filter((f) => /^gcc-backup-.*\.json$/.test(f)).sort();
  all.slice(0, Math.max(0, all.length - 14)).forEach((f) => fs.unlink(path.join(dir, f), () => {}));
  return file;
});
ipcMain.handle('openBackups', () => { fs.mkdirSync(backupDir(), { recursive: true }); return shell.openPath(backupDir()); });
ipcMain.on('tray', (_, t) => tray && tray.setToolTip(String(t).slice(0, 120)));
ipcMain.on('show', showWin);
ipcMain.on('prefs', (_, p) => {
  if (typeof p.trayClose === 'boolean') closeToTray = p.trayClose;
  const th = THEMES[p.theme];
  if (th && win) { win.setBackgroundColor(th[0]); if (win.setTitleBarOverlay) try { win.setTitleBarOverlay({ color: th[0], symbolColor: th[1], height: 36 }); } catch {} }
});

app.whenReady().then(() => { createWindow(); app.on('activate', showWin); });
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

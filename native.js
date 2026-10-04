import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Browser } from '@capacitor/browser';

export const isNative = () => Capacitor.isNativePlatform();

// Android 12+: without the exact-alarm grant, "focus done" alarms are delayed while the phone is locked.
export async function ensureExact() {
  if (!isNative()) return;
  try { const r = await LocalNotifications.checkExactNotificationSetting(); if (r.exact_alarm !== 'granted') await LocalNotifications.changeExactNotificationSetting(); } catch {}
}

// Android: mark the page as native (hides the Windows title bar, adds safe-area padding) and schedule the
// daily reminder with the OS, because a closed app can't run timers or web notifications.
export async function setupNative(s) {
  if (!isNative()) return;
  document.documentElement.classList.add('native');
  try {
    const p = await LocalNotifications.checkPermissions();
    if (p.display !== 'granted') await LocalNotifications.requestPermissions();
    await ensureExact();
    await LocalNotifications.cancel({ notifications: [{ id: 1 }] });
    if (!s.notify) return;
    const [hour, minute] = String(s.remindAt || '20:00').split(':').map(Number);
    await LocalNotifications.schedule({ notifications: [{
      id: 1, title: 'GATE Command Center', body: "Log today's study and check your revisions.",
      schedule: { on: { hour, minute }, allowWhileIdle: true },
    }] });
  } catch {}
}

// Saves text as a file. Desktop/browser: normal download. Android WebView ignores blob downloads,
// so write to the app cache and open the share sheet (Save to Drive / Files / send to yourself).
export async function saveFile(name, text, mime) {
  if (isNative()) {
    const w = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: name, url: w.uri, dialogTitle: 'Save or send this file' });
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1e4);
}

// Opens a web link outside the app (system browser on Android, new tab on the web; Electron handles it in main.js).
export function openLink(url) {
  if (isNative()) return Browser.open({ url }).catch(() => {});
  window.open(url, '_blank', 'noopener');
}

// Countdown / break end: let the OS fire the alert even if the app is closed. Pass null to cancel.
export async function scheduleTimerEnd(at, body) {
  if (!isNative()) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: 2 }] });
    if (at) await LocalNotifications.schedule({ notifications: [{ id: 2, title: 'GATE Command Center', body, schedule: { at: new Date(at), allowWhileIdle: true } }] });
  } catch {}
}

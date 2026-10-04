import { isNative } from './native.js';

// Web build only (not the Electron or Android app): safe-area styling + offline support.
export function setupWeb() {
  if (window.gcc || isNative()) return;
  document.documentElement.classList.add('web');
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
}

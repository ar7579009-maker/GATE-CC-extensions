// Isolated-world helper: Sync button, auto-sync on PW visits, window start, and message passing to/from main.js and the background worker.
(() => {
  if (window.top !== window) return;
  const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => { void chrome.runtime.lastError; res(r); }); } catch { res(null); } });
  let btn, label, busy = false;

  function makeButton() {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483646';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>button{font:600 13px system-ui,sans-serif;border:0;border-radius:999px;padding:10px 16px;cursor:pointer;background:#5a4bda;color:#fff;box-shadow:0 4px 16px #0006}button:disabled{opacity:.8;cursor:default}</style><button>Sync GATE data</button>';
    btn = root.querySelector('button'); label = (t) => { btn.textContent = t; };
    btn.onclick = async () => { if (busy) return; busy = true; btn.disabled = true; label('Syncing… (see the new window)'); await send({ cmd: 'start' }); };
    document.documentElement.appendChild(host);
  }

  function status(m) {
    if (!btn) return;
    if (m.kind === 'progress') label(`Syncing… ${m.pct}%`);
    else { busy = false; btn.disabled = false; label(m.kind === 'done' ? 'Synced ✓ (sync again)' : 'Sync failed (try again)'); }
  }

  send({ cmd: 'whoami' }).then(async (r) => {
    if (r && r.sync) { window.postMessage({ gccBridge: 'run' }, '*'); return; }
    makeButton();
    const a = await send({ cmd: 'auto' });
    if (a && a.run && !busy) { busy = true; btn.disabled = true; label('Syncing…'); window.postMessage({ gccBridge: 'run', compact: true }, '*'); }
  });

  addEventListener('message', (e) => {
    const m = e.data; if (e.source !== window || !m || !m.gccMain) return;
    if (m.gccMain === 'close') { send({ cmd: 'close' }); return; }
    if (m.gccMain === 'save') { send({ cmd: 'save', name: m.name, json: m.json }); return; }
    send({ cmd: 'relay', payload: { cmd: 'status', kind: m.gccMain, pct: m.pct, text: m.text } });
    status({ kind: m.gccMain, pct: m.pct });
    if (m.gccMain === 'done') setTimeout(() => send({ cmd: 'close' }), 6000);
  });

  try { chrome.runtime.onMessage.addListener((m) => { if (m.cmd === 'status') status(m); }); } catch {}
})();

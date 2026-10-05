// Runs inside the page (main world). Two jobs:
//  1) remember the sign-in headers the page itself uses for api.penpencil.co (in memory only, never stored or sent anywhere else)
//  2) when the bridge says "run" (sync window only): run the crawl with core.js, show progress, save one JSON file.
(() => {
  if (window.__gccSync) return; window.__gccSync = true;
  const origFetch = window.fetch.bind(window);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cap = { headers: null, any: null, userId: null };
  const DROP = /^(content-type|content-length|accept-encoding|host|connection|origin|referer|user-agent|sec-.*)$/i;
  const isApi = (u) => { try { return new URL(u, location.href).host === 'api.penpencil.co'; } catch { return false; } };

  function take(url, hdrs) {
    if (!isApi(url)) return;
    const h = {}, put = (k, v) => { if (k && !DROP.test(k)) h[String(k).toLowerCase()] = String(v); };
    if (hdrs) {
      if (Array.isArray(hdrs)) hdrs.forEach((p) => put(p[0], p[1]));
      else if (typeof hdrs.forEach === 'function') hdrs.forEach((v, k) => put(k, v));
      else Object.keys(hdrs).forEach((k) => put(k, hdrs[k]));
    }
    if (Object.keys(h).length) { cap.any = h; if (h.authorization) cap.headers = h; }
    const m = /[?&]userId=([0-9a-f]{24})/.exec(url); if (m) cap.userId = m[1];
  }

  window.fetch = function (input, init) {
    try { take(typeof input === 'string' ? input : input && input.url, (init && init.headers) || (input && input.headers)); } catch {}
    return origFetch(input, init);
  };
  const xo = XMLHttpRequest.prototype.open, xh = XMLHttpRequest.prototype.setRequestHeader, xs = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__gu = u; this.__gh = {}; return xo.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { try { if (this.__gh) this.__gh[k] = v; } catch {} return xh.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () { try { take(this.__gu, this.__gh); } catch {} return xs.apply(this, arguments); };

  const post = (o) => window.postMessage(o, '*');

  function overlay(compact) {
    const host = document.createElement('div');
    host.style.cssText = compact ? 'position:fixed;right:14px;bottom:14px;z-index:2147483647' : 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#0b0d12f2';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      .c{font:14px system-ui,sans-serif;color:#e8e8ee;width:min(480px,92vw)}.k{width:280px;background:#14161cf2;padding:12px 14px;border-radius:12px;box-shadow:0 4px 16px #0006}.k h1{font-size:13px;margin:0 0 8px}.k pre{display:none}h1{font-size:18px;margin:0 0 14px}
      .bar{height:8px;background:#2a2d38;border-radius:99px;overflow:hidden}.bar i{display:block;height:100%;width:0;background:#7363fc;transition:width .3s}
      .m{margin:12px 0 8px;min-height:20px}pre{margin:0 0 14px;max-height:200px;overflow:auto;font:11px ui-monospace,monospace;color:#9aa0b4;white-space:pre-wrap}
      button{font:600 13px system-ui;border:0;border-radius:8px;padding:8px 14px;margin-right:8px;cursor:pointer;background:#2a2d38;color:#eee}.ok{color:#6fdc8c}.bad{color:#ff8a80}
    </style><div class="c${compact ? ' k' : ''}"><h1>GATE Command Center · PW sync</h1><div class="bar"><i id="b"></i></div><div class="m" id="m">Starting…</div><pre id="l"></pre>
    <button id="x">Cancel</button><button id="s" hidden>Save file again</button><button id="c" hidden>Close window</button></div>`;
    document.documentElement.appendChild(host);
    const $ = (i) => root.getElementById(i), lines = [];
    return {
      pct: (p) => { $('b').style.width = p + '%'; }, msg: (t) => { $('m').textContent = t; $('m').className = 'm'; },
      log: (t) => { lines.push(t); if (lines.length > 40) lines.shift(); $('l').textContent = lines.join('\n'); $('l').scrollTop = 1e9; },
      onCancel: (f) => { $('x').onclick = f; }, onSave: (f) => { $('s').hidden = false; $('s').onclick = f; },
      finish: (ok, t) => { if (compact) setTimeout(() => host.remove(), 8000); $('m').textContent = t; $('m').className = 'm ' + (ok ? 'ok' : 'bad'); $('x').hidden = true; $('c').hidden = false; $('c').onclick = () => { post({ gccMain: 'close' }); if (compact) host.remove(); }; if (ok) $('b').style.width = '100%'; },
    };
  }

  let running = false, cancelFlag = false;
  async function run(compact) {
    if (running) return; running = true;
    const u = overlay(compact); u.onCancel(() => { cancelFlag = true; u.msg('Cancelling…'); });
    const progress = (o) => { if (o.pct != null) { u.pct(o.pct); post({ gccMain: 'progress', pct: o.pct }); } if (o.msg) u.msg(o.msg); };
    try {
      u.msg('Waiting for the page to sign in…');
      const t0 = Date.now(); while (!cap.headers && Date.now() - t0 < 25000) await sleep(300);
      if (!cap.headers) u.log('No sign-in header seen yet, trying anyway');
      const api = GCCCore.makeApi({ fetchFn: origFetch, getHeaders: () => cap.headers || cap.any || {} });
      const out = await GCCCore.crawl(api, { userId: cap.userId, log: u.log, progress, cancelled: () => cancelFlag });
      const d = new Date(), p = (n) => String(n).padStart(2, '0');
      const name = `pw-sync-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`, json = JSON.stringify(out);
      post({ gccMain: 'save', name, json }); u.onSave(() => post({ gccMain: 'save', name, json }));
      const t = out.totals, w = out.meta.warnings.length;
      const text = `Saved ${name}: ${t.done}/${t.lectures} lectures watched, ${out.tests.length} tests, ${out.results.length} result(s)${w ? `, ${w} warning(s)` : ''}.`;
      u.finish(true, text); post({ gccMain: 'done', text });
    } catch (e) {
      const text = e.cancelled ? 'Cancelled.' : e.auth ? 'PW says you are signed out. Sign in in this window, close it, then press Sync again.' : 'Failed: ' + e.message;
      u.finish(false, text); post({ gccMain: 'error', text });
    } finally { running = false; }
  }
  addEventListener('message', (e) => { if (e.source === window && e.data && e.data.gccBridge === 'run') run(!!e.data.compact); });
})();

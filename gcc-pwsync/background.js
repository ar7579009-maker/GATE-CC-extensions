// Opens sync windows, relays progress, saves the result to Downloads\GCC\pw-sync-latest.json, and schedules automatic syncs.
const KEY = 'gccSyncTabs', LAST = 'gccLast', TRY = 'gccTry';
const AUTO_HOURS = 4;                 // sync when you open PW and the last sync is older than this
const EOD = { hour: 22, minute: 0 };  // end-of-day sync (needs Chrome open; a missed one runs when Chrome wakes)
const FILE = 'GCC/pw-sync-latest.json';
const H = 36e5, RETRY_GAP = 30 * 60e3;

const load = async () => (await chrome.storage.session.get(KEY))[KEY] || {};
const save = (st) => chrome.storage.session.set({ [KEY]: st });
const getNum = async (k) => (await chrome.storage.local.get(k))[k] || 0;
const setNum = (k, v) => chrome.storage.local.set({ [k]: v });

async function openSync(opener, focused) {
  const w = await chrome.windows.create({ url: 'https://www.pw.live/study-v2/study', type: 'popup', width: 560, height: 720, focused });
  const st = await load(); st[w.tabs[0].id] = { opener, windowId: w.id, started: false }; await save(st);
  return w;
}

function toB64(str) {
  const u = new TextEncoder().encode(str); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

chrome.runtime.onMessage.addListener((msg, sender, send) => {
  (async () => {
    const st = await load(), tabId = sender.tab && sender.tab.id;
    if (msg.cmd === 'start') {
      await setNum(TRY, Date.now()); await openSync(tabId, true); send({ ok: true });
    } else if (msg.cmd === 'whoami') {
      const e = st[tabId];
      if (e && !e.started) { e.started = true; await save(st); send({ sync: true }); } else send({ sync: false });
    } else if (msg.cmd === 'auto') {
      const due = Date.now() - (await getNum(LAST)) > AUTO_HOURS * H && Date.now() - (await getNum(TRY)) > RETRY_GAP;
      if (due) await setNum(TRY, Date.now());
      send({ run: due });
    } else if (msg.cmd === 'save') {
      try {
        await chrome.downloads.download({ url: 'data:application/json;base64,' + toB64(msg.json), filename: FILE, conflictAction: 'overwrite', saveAs: false });
        await setNum(LAST, Date.now()); send({ ok: true });
      } catch (e) { send({ ok: false, error: String(e && e.message || e) }); }
    } else if (msg.cmd === 'relay') {
      const e = st[tabId]; if (e && e.opener != null) chrome.tabs.sendMessage(e.opener, msg.payload).catch(() => {}); send({ ok: true });
    } else if (msg.cmd === 'close') {
      const e = st[tabId]; if (e) { delete st[tabId]; await save(st); chrome.windows.remove(e.windowId).catch(() => {}); } send({ ok: true });
    } else send({});
  })();
  return true;
});

chrome.windows.onRemoved.addListener(async (id) => {
  const st = await load(); let ch = false;
  for (const k of Object.keys(st)) if (st[k].windowId === id) { delete st[k]; ch = true; }
  if (ch) await save(st);
});

function planEod() {
  const n = new Date(), t = new Date(n.getFullYear(), n.getMonth(), n.getDate(), EOD.hour, EOD.minute);
  if (t <= n) t.setDate(t.getDate() + 1);
  chrome.alarms.create('gccEod', { when: +t, periodInMinutes: 1440 });
}
chrome.alarms.get('gccEod', (a) => { if (!a) planEod(); });
chrome.runtime.onInstalled.addListener(planEod);
chrome.runtime.onStartup.addListener(async () => {
  planEod();
  if (Date.now() - (await getNum(LAST)) > 24 * H) chrome.alarms.create('gccCatch', { delayInMinutes: 2 });
});
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'gccEod' && a.name !== 'gccCatch') return;
  if (Date.now() - (await getNum(LAST)) < 3 * H || Date.now() - (await getNum(TRY)) < RETRY_GAP) return;
  await setNum(TRY, Date.now()); await openSync(null, false);
});

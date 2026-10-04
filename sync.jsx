import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { SYNCED, hash, logOp, sumLogs, mergeKey } from './sync-core.js';
import { openLink } from './native.js';

const PRIVACY_URL = 'https://ar7579009-maker.github.io/GATE-CC/privacy.html'; // update if your Pages address differs

const SB_URL = 'https://haeyoyzkdbzyqdbtxunj.supabase.co';
const SB_KEY = 'sb_publishable_zKGtqCEbHwRuCHtbNWDAwg_I8VI65sH'; // publishable key: safe to ship in the app
export const sb = createClient(SB_URL, SB_KEY);

/* ── per-device sync bookkeeping (kept outside the app state so it never syncs itself) ── */
const META = 'gcc_sync_meta_v1';
let meta = (() => { try { return JSON.parse(localStorage.getItem(META)) || {}; } catch { return {}; } })();
meta.dev = meta.dev || crypto.randomUUID().slice(0, 8);
meta.keys = meta.keys || {}; meta.devLogs = meta.devLogs || {}; meta.other = meta.other || {};
const save = () => { try { localStorage.setItem(META, JSON.stringify(meta)); } catch {} };
save();

// Which synced keys changed since last time? Also computes this device's own share of the study log.
function detect(state) {
  const now = Date.now(), dirty = [];
  SYNCED.forEach((k) => {
    if (state[k] === undefined) return;
    const h = hash(state[k]), e = meta.keys[k];
    if (!e || e.h !== h) meta.keys[k] = { h, t: now, dirty: true };
    if (meta.keys[k].dirty) dirty.push(k);
  });
  const mine = logOp(state.log, meta.other, -1), mh = hash(mine);
  if (meta.mineH !== mh) { meta.mineH = mh; meta.mineT = now; meta.mineDirty = true; }
  return { dirty, mine };
}

async function push(state) {
  const { dirty, mine } = detect(state);
  const rows = dirty.map((k) => ({ key: k, value: { v: state[k], t: meta.keys[k].t } }));
  if (meta.mineDirty) rows.push({ key: 'log:' + meta.dev, value: { v: mine, t: meta.mineT } });
  if (!rows.length) { save(); return; }
  const { error } = await sb.from('state').upsert(rows, { onConflict: 'user_id,key' });
  if (error) throw error;
  dirty.forEach((k) => { if (meta.keys[k].h === hash(state[k])) meta.keys[k].dirty = false; });
  if (meta.mineH === hash(mine)) meta.mineDirty = false;
  save();
}

async function pull(ref, setS) {
  let q = sb.from('state').select('key,value,updated_at').order('updated_at', { ascending: true });
  if (meta.since) q = q.gte('updated_at', meta.since);
  const { data, error } = await q;
  if (error) throw error;
  const st = ref.current;
  if (!meta.init) {
    // First sync on this device: existing local data counts as "oldest", so the server's copy wins,
    // except ticks/mocks/log which merge. Keys the server doesn't have yet get pushed.
    SYNCED.forEach((k) => {
      const has = data.some((r) => r.key === k);
      meta.keys[k] = has ? { h: hash(st[k]), t: 0, dirty: false } : { h: '', t: 0, dirty: false };
    });
  }
  const changes = {}; let logChanged = false, since = meta.since; const oldOther = meta.other;
  for (const row of data) {
    if (!since || row.updated_at > since) since = row.updated_at;
    if (row.key.startsWith('log:')) {
      const d = row.key.slice(4);
      if (d !== meta.dev) { const nv = row.value?.v || {}; if (hash(nv) !== hash(meta.devLogs[d])) { meta.devLogs[d] = nv; logChanged = true; } }
      continue;
    }
    if (!SYNCED.includes(row.key) || !row.value) continue;
    const res = mergeKey(row.key, row.key in changes ? changes[row.key] : st[row.key], meta.keys[row.key], row.value);
    if (!res) continue;
    const cur = row.key in changes ? changes[row.key] : st[row.key];
    if (hash(res.v) !== hash(cur)) changes[row.key] = res.v; // skip no-op merges: they re-render and re-trigger sync forever
    meta.keys[row.key] = { h: hash(res.v), t: res.t, dirty: res.dirty || !!meta.keys[row.key]?.dirty };
  }
  if (logChanged) meta.other = sumLogs(Object.values(meta.devLogs));
  meta.since = since || meta.since; meta.init = true; save();
  if (Object.keys(changes).length || logChanged) {
    const newOther = meta.other;
    setS((p) => ({ ...p, ...changes, ...(logChanged ? { log: logOp(logOp(p.log, oldOther, -1), newOther, 1) } : {}) }));
  }
}

export function useSync(s, setS, fresh) {
  const ref = useRef(s); ref.current = s;
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('signed-out');
  const [last, setLast] = useState('');
  const busy = useRef(false), again = useRef(false), runRef = useRef(null);

  const run = useCallback(async () => {
    if (busy.current) { again.current = true; return; }
    busy.current = true; setStatus('syncing');
    try {
      const first = !meta.init;
      if (!first) await push(ref.current);
      await pull(ref, setS);
      if (first) again.current = true; // push what the server lacks once the merged state has rendered
      setStatus('ok'); setLast(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (e) { setStatus(navigator.onLine === false ? 'offline' : 'error: ' + (e.message || e)); }
    finally { busy.current = false; if (again.current) { again.current = false; setTimeout(() => runRef.current(), 800); } }
  }, [setS]);
  runRef.current = run;

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setUser(data.session?.user || null));
    const { data } = sb.auth.onAuthStateChange((_e, sess) => setUser(sess?.user || null));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!user) { setStatus('signed-out'); return; }
    // Data on this device belongs to whoever synced it first. Never merge it into a different account.
    if (meta.uid && meta.uid !== user.id) {
      const ok = window.confirm('This device still holds data from a different account.\n\nOK = clear it and load this account\'s data.\nCancel = sign out and keep it.');
      if (!ok) { sb.auth.signOut(); return; }
      meta = { dev: meta.dev, uid: user.id, keys: {}, devLogs: {}, other: {} }; save();
      setS(() => fresh());   // the state change schedules the first sync
      return;
    }
    meta.uid = user.id; save(); run();
  }, [user]);
  useEffect(() => { if (!user) return; const t = setTimeout(run, 4000); return () => clearTimeout(t); }, [s, user]);
  useEffect(() => {
    if (!user) return;
    const go = () => runRef.current(), vis = () => document.visibilityState === 'visible' && go();
    const i = setInterval(go, 60000);
    window.addEventListener('online', go); document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(i); window.removeEventListener('online', go); document.removeEventListener('visibilitychange', vis); };
  }, [user]);

  return {
    user, status, last, run,
    sendCode: (email) => sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } }),   // emails a 6-digit code; creates the account on first use
    verifyCode: (email, token) => sb.auth.verifyOtp({ email, token, type: 'email' }),
    signOut: async () => { await sb.auth.signOut(); meta = { dev: meta.dev, uid: meta.uid, keys: {}, devLogs: {}, other: {} }; save(); },
    deleteAccount: async () => {
      const { error } = await sb.rpc('delete_my_account');
      if (error) return { error };
      try { await sb.auth.signOut({ scope: 'local' }); } catch {}
      meta = { dev: meta.dev, keys: {}, devLogs: {}, other: {} }; save();   // the account no longer exists
      return {};
    },
  };
}

export function SyncCard({ sync }) {
  const [email, setEmail] = useState(''), [code, setCode] = useState(''), [sent, setSent] = useState(false), [msg, setMsg] = useState(''), [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('');
  const good = /^(Code sent|Account deleted)/.test(msg);
  const privacy = <div className="dim small" style={{ marginTop: 8 }}><a href={PRIVACY_URL} onClick={(e) => { e.preventDefault(); openLink(PRIVACY_URL); }}>Privacy policy</a></div>;
  const field = { color: 'var(--ink)', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6, padding: '7px 9px', flex: 1, minWidth: 160 };
  const em = email.trim().toLowerCase(), okEmail = /^\S+@\S+\.\S+$/.test(em);
  const send = async () => { setBusy(true); setMsg(''); const { error } = await sync.sendCode(em); setBusy(false); if (error) setMsg(error.message); else { setSent(true); setMsg('Code sent. Check your email (and spam).'); } };
  const verify = async () => { setBusy(true); setMsg(''); const { error } = await sync.verifyCode(em, code.trim()); setBusy(false); if (error) setMsg(error.message); else { setCode(''); setSent(false); setMsg(''); } };
  if (sync.user) return (
    <div className="card">
      <h3>Sync</h3>
      <div className="small mute">Signed in as {sync.user.email}</div>
      <div className="small" style={{ margin: '4px 0 8px', color: sync.status.startsWith('error') ? 'var(--red)' : 'var(--mute)' }}>
        {sync.status === 'ok' ? `Up to date${sync.last ? ' · ' + sync.last : ''}` : sync.status === 'syncing' ? 'Syncing…' : sync.status === 'offline' ? 'Offline: changes are saved here and will sync later' : sync.status}
      </div>
      <div className="row">
        <button className="btn ghost" onClick={sync.run}>Sync now</button>
        <button className="btn ghost" onClick={sync.signOut}>Sign out</button>
        <button className="btn ghost" onClick={() => { setMode(mode === 'delete' ? '' : 'delete'); setMsg(''); setCode(''); }}>Delete account</button>
      </div>
      {mode === 'delete' && <div style={{ marginTop: 8 }}>
        <div className="small" style={{ color: 'var(--red)', marginBottom: 6 }}>This permanently deletes your account and all synced data from the server. Data already on your devices stays until you clear it. Type DELETE to confirm.</div>
        <div className="row">
          <input type="text" placeholder="DELETE" value={code} onChange={(e) => setCode(e.target.value)} style={field} />
          <button className="btn stop" disabled={code.trim() !== 'DELETE'} onClick={async () => { const { error } = await sync.deleteAccount(); if (error) setMsg(error.message); else { setMsg('Account deleted. Your data is still on this device.'); setMode(''); setCode(''); } }}>Delete forever</button>
        </div>
      </div>}
      {msg && <div className="small" style={{ color: good ? 'var(--green)' : 'var(--red)', marginTop: 6 }}>{msg}</div>}
      {privacy}
    </div>
  );
  return (
    <div className="card">
      <h3>Sync between devices</h3>
      <div className="small mute" style={{ marginBottom: 8 }}>No password. Enter your email, we send a 6-digit code, enter it here. New emails get an account automatically. Use the same email on every device.</div>
      <div className="row">
        <input type="text" inputMode="email" autoComplete="email" placeholder="you@email.com" value={email} onChange={(e) => { setEmail(e.target.value); setSent(false); }} style={{ flex: 1, minWidth: 160 }} />
        <button className="btn" disabled={!okEmail || busy} onClick={send}>{sent ? 'Resend code' : 'Send code'}</button>
      </div>
      {sent && <div className="row" style={{ marginTop: 8 }}>
        <input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} style={field} />
        <button className="btn" disabled={code.trim().length < 6 || busy} onClick={verify}>Sign in</button>
      </div>}
      <div className="dim small" style={{ marginTop: 6 }}>Already have data on two devices? Sign in first on the one with the most data.</div>
      {msg && <div className="small" style={{ color: good ? 'var(--green)' : 'var(--red)', marginTop: 6 }}>{msg}</div>}
      {privacy}
    </div>
  );
}

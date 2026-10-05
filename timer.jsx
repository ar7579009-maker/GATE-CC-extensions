import React, { useState, useEffect, useRef } from 'react';
import { Num } from './ui.js';
import { scheduleTimerEnd } from './native.js';
import { N, tSeg, tTotal, settleAt, commit as commitSession, uncommit, jWrite, jRead, boot, HB_MS } from './timer-engine.js';
export { tSeg, tTotal };

const dkey = (d = new Date()) => new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const clock = (sec) => { sec = Math.max(0, Math.floor(sec)); const p = (n) => String(n).padStart(2, '0'), h = Math.floor(sec / 3600); return `${h ? p(h) + ':' : ''}${p(Math.floor(sec / 60) % 60)}:${p(sec % 60)}`; };
const sumO = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
const fmtT = (ms) => new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const fmtD = (k) => new Date(k + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const addD = (k, n) => { const d = new Date(k + 'T12:00:00'); d.setDate(d.getDate() + n); return dkey(d); };
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// timer = { sub, ts (segment start), mode: free|cd|break, target (s), carry (s already logged in this block), acc (s before current run), runAt (ms | null when paused), note, alerted, keep }
// Old saved timers ({sub, ts}) are treated as free + running since ts.

const addLog = (log, day, sub, secs) => { const row = { ...log[day] }, v = (row[sub] || 0) + secs; if (v > 1e-6) row[sub] = v; else delete row[sub]; return { ...log, [day]: row }; };
const commit = (p, t, secs, end, id) => commitSession(p, t, secs, end, id, dkey);   // midnight-safe

function ding(msg) {
  try { const A = new (window.AudioContext || window.webkitAudioContext)(); [0, .25, .5].forEach((d, i) => { const o = A.createOscillator(), g = A.createGain(); o.frequency.value = 660 + i * 110; g.gain.value = .15; o.connect(g); g.connect(A.destination); o.start(A.currentTime + d); o.stop(A.currentTime + d + .18); }); } catch {}
  try { navigator.vibrate?.([300, 150, 300]); } catch {}
  try { if (window.Notification && Notification.permission === 'granted') { try { new Notification('GATE Command Center', { body: msg }); } catch { navigator.serviceWorker?.ready.then((r) => r.showNotification('GATE Command Center', { body: msg, icon: 'icon-192.png' })); } } } catch {}
}

export function useTimerEngine({ s, setS, set, tab, rows }) {
  const t = s.timer ? N(s.timer) : null, run = !!(t && t.runAt);
  const [now, setNow] = useState(Date.now()), [toast, setToast] = useState(null);
  useEffect(() => { if (!run) return; setNow(Date.now()); const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, [run]);
  useEffect(() => { if (!toast) return; const i = setTimeout(() => setToast(null), 12000); return () => clearTimeout(i); }, [toast]);
  const name = (id) => rows.find((r) => r.id === id)?.name || id;
  const total = t ? tTotal(t, now) : 0, left = t && t.mode !== 'free' ? t.target - total : null, done = left !== null && left <= 0;
  const fired = useRef('');
  useEffect(() => {
    if (!t || !done || t.alerted || fired.current === `${t.ts}:${t.carry}`) return;
    fired.current = `${t.ts}:${t.carry}`;
    setS((p) => (p.timer ? { ...p, timer: { ...p.timer, alerted: true } } : p));
    ding(t.mode === 'break' ? 'Break over. Back to it!' : `${Math.round(t.target / 60)} min focus done. Great work!`);
  }, [done, t && t.ts, t && t.carry]);
  useEffect(() => {
    const rem = t && t.mode !== 'free' && run && !t.alerted ? t.target - tTotal(t, Date.now()) : 0;
    scheduleTimerEnd(rem > 1 ? Date.now() + rem * 1000 : null, t && t.mode === 'break' ? 'Break over. Back to it!' : `${Math.round((t ? t.target : 0) / 60)} min focus done. Great work!`);
  }, [run, t && t.ts, t && t.carry, t && t.mode, t && t.target, t && t.alerted]);
  useEffect(() => { document.title = t ? `${run ? '' : '⏸ '}${left !== null && left <= 0 ? '+' : ''}${clock(left !== null ? Math.abs(left) : total)} · ${t.mode === 'break' ? 'Break' : name(t.sub)}` : 'GATE CSE 2027 Command Center'; });
  useEffect(() => {
    if (!run || !navigator.wakeLock) return; let lock;
    const get = () => navigator.wakeLock.request('screen').then((l) => { lock = l; }).catch(() => {});
    get(); const vis = () => document.visibilityState === 'visible' && get(); document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); lock?.release().catch(() => {}); };
  }, [run]);

  const tRef = useRef(null); tRef.current = s.timer;
  const [rec, setRec] = useState(null);
  useEffect(() => { const b = boot(s.timer, jRead(localStorage), Date.now()); if (b.src === 'journal' && b.t) setS((p) => ({ ...p, timer: b.t })); if (b.ask) setRec(b.ask); }, []);   // once per cold start
  useEffect(() => { jWrite(localStorage, s.timer); }, [s.timer]);                                  // start/pause/switch/note/stop hit disk instantly, independent of the big state blob
  useEffect(() => {
    const beat = () => tRef.current && tRef.current.runAt && jWrite(localStorage, tRef.current);
    const wake = () => { setNow(Date.now()); beat(); }, vis = () => (document.visibilityState === 'visible' ? wake() : beat());
    const i = setInterval(beat, HB_MS);
    document.addEventListener('visibilitychange', vis); addEventListener('pageshow', wake); addEventListener('focus', wake); addEventListener('pagehide', beat);
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', vis); removeEventListener('pageshow', wake); removeEventListener('focus', wake); removeEventListener('pagehide', beat); };
  }, []);

  const api = {
    start: () => { const n = Date.now(), m = s.tmode, cd = m !== 'free'; set('timer', { sub: s.tsub, ts: n, mode: cd ? 'cd' : 'free', target: cd ? (m === 'custom' ? s.tcustom : m) * 60 : 0, carry: 0, acc: 0, runAt: n, note: '', tag: s.ttag || 'L' }); setToast(null); },
    pause: () => set('timer', (x) => ({ ...N(x), acc: tSeg(x, Date.now()), runAt: null })),
    resume: () => set('timer', (x) => ({ ...N(x), runAt: Date.now() })),
    stop: () => {
      const n = Date.now(), secs = tSeg(t, n), id = newId(), ok = t.mode !== 'break' && secs >= 60;
      setS((p) => ({ ...commit(p, t, secs, n, id), timer: null }));
      setToast(t.mode === 'break' ? null : ok ? { msg: `Logged ${Math.round(secs / 60)} min · ${name(t.sub)}`, undo: { id, t, secs } } : { msg: 'Under 1 minute, so it was not logged.' });
    },
    undo: () => { const u = toast.undo; setS((p) => ({ ...uncommit(p, u.id, dkey), timer: p.timer || { ...u.t, acc: u.secs, runAt: null } })); setToast(null); },
    discard: () => { if (tSeg(t, Date.now()) > 60 && !confirm('Discard this session without logging it?')) return; set('timer', null); setToast(null); },
    switchSub: (sub) => {
      const n = Date.now(), secs = tSeg(t, n); if (t.mode === 'break' || sub === t.sub) return;
      if (secs < 60) { set('timer', (x) => ({ ...x, sub })); return; }
      setS((p) => ({ ...commit(p, t, secs, n, newId()), timer: { ...t, sub, ts: n, carry: t.carry + secs, acc: 0, runAt: t.runAt ? n : null, note: '' } }));
    },
    takeBreak: () => { const n = Date.now(), secs = tSeg(t, n); setS((p) => ({ ...commit(p, t, secs, n, newId()), timer: { sub: null, ts: n, mode: 'break', target: (p.breakMin || 5) * 60, carry: 0, acc: 0, runAt: n, note: '' } })); },
    recKeep: () => setRec(null),
    recStopAt: () => { set('timer', (x) => settleAt(x, rec.last)); setRec(null); },
    keepGoing: () => set('timer', (x) => ({ ...x, keep: true })),
    manual: (sub, mins, day, time, note) => {
      const start = new Date(`${day}T${time}`).getTime(), secs = mins * 60; if (!(mins >= 1) || isNaN(start)) return false;
      setS((p) => ({ ...p, log: addLog(p.log, day, sub, secs), sessions: [...(p.sessions || []), { id: newId(), day, sub, start, end: start + secs * 1000, secs, note }] })); setToast({ msg: `Added ${mins} min · ${name(sub)}` }); return true;
    },
    remove: (id) => setS((p) => uncommit(p, id, dkey)),
    note: (id, note) => setS((p) => ({ ...p, sessions: (p.sessions || []).map((e) => (e.id === id ? { ...e, note } : e)) })),
  };
  useEffect(() => {
    const k = (e) => {
      if (e.code !== 'Space' || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName) || e.target.isContentEditable) return;
      if (t) { e.preventDefault(); run ? api.pause() : api.resume(); } else if (tab === 'today') { e.preventDefault(); api.start(); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });
  return { t, now, total, left, done, toast, api, name, rec };
}

const Ring = ({ a, b, children }) => {
  const arc = (r, f, w, c) => { const L = 2 * Math.PI * r; return <><circle cx="60" cy="60" r={r} fill="none" stroke="var(--panel2)" strokeWidth={w} /><circle cx="60" cy="60" r={r} fill="none" stroke={c} strokeWidth={w} strokeDasharray={`${L * Math.min(1, Math.max(0, f))} ${L}`} /></>; };
  return <div className="ringw"><svg viewBox="0 0 120 120">{arc(54, a.f, 7, a.c)}{arc(44, b.f, 3, b.c)}</svg><div className="ringc">{children}</div></div>;
};

function Manual({ rows, api, tsub }) {
  const [m, setM] = useState({ sub: tsub, mins: 30, day: dkey(), time: '09:00', note: '' });
  const up = (k, v) => setM((x) => ({ ...x, [k]: v }));
  return <div className="row" style={{ marginTop: 8 }}>
    <select value={m.sub} onChange={(e) => up('sub', e.target.value)}>{rows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
    <Num min={1} max={720} value={m.mins} onValue={(v) => up('mins', v)} style={{ width: 64 }} /><span className="small mute">min</span>
    <input type="date" value={m.day} max={dkey()} onChange={(e) => e.target.value && up('day', e.target.value)} />
    <input type="time" value={m.time} onChange={(e) => e.target.value && up('time', e.target.value)} />
    <input type="text" placeholder="note" value={m.note} onChange={(e) => up('note', e.target.value)} style={{ flex: 1, minWidth: 90 }} />
    <button className="btn sm" onClick={() => api.manual(m.sub, m.mins, m.day, m.time, m.note)}>Add</button>
  </div>;
}

function NoteEdit({ e, api }) {
  const [on, setOn] = useState(false);
  if (!on) return <button className="ink" style={{ flex: 1, textAlign: 'left' }} onClick={() => setOn(true)}>{e.note || '+ note'}</button>;
  return <input type="text" autoFocus defaultValue={e.note} onBlur={(ev) => { setOn(false); ev.target.value !== e.note && api.note(e.id, ev.target.value); }} onKeyDown={(ev) => ev.key === 'Enter' && ev.target.blur()} style={{ flex: 1, minWidth: 80, padding: '3px 6px' }} />;
}

export function TimerCard({ s, set, eng, rows, todaySec }) {
  const { t, total, left, done, toast, api, name, rec } = eng, run = !!(t && t.runAt), brk = t && t.mode === 'break', goal = s.goalH * 3600;
  const idleMin = s.tmode === 'free' ? 0 : (s.tmode === 'custom' ? s.tcustom : s.tmode);
  const shown = t ? (left !== null ? Math.abs(left) : total) : idleMin * 60;
  const sessF = !t ? 0 : left !== null ? total / t.target : (total % 3600) / 3600;
  const list = (s.sessions || []).filter((e) => e.day === dkey()).sort((a, b) => b.start - a.start);
  const col = t ? (run ? (done ? 'var(--green)' : 'var(--amber)') : 'var(--mute)') : 'var(--ink)';
  const TAGS = [['L', 'Learn'], ['P', 'Practice'], ['R', 'Revise']], curTag = t ? (t.tag || 'L') : (s.ttag || 'L');
  return (<div className="card">
    <h2 style={{ textAlign: 'center', marginBottom: 8 }}>Deep-work timer</h2>
    <div className="row" style={{ marginBottom: 10, justifyContent: 'center' }}>{TAGS.map(([k, l]) => <button key={k} disabled={!!t} className={`btn sm ${curTag === k ? '' : 'ghost'}`} onClick={() => set('ttag', k)}>{l}</button>)}</div>
    {rec && t && <div className="toast" role="alert"><span>Timer was running while the app was closed (last seen {fmtT(rec.last)}). Still studying?</span><span className="row"><button className="btn sm" onClick={api.recKeep}>Keep all</button><button className="btn sm ghost" onClick={api.recStopAt}>Stop at {fmtT(rec.last)}</button></span></div>}
    <div style={{ textAlign: 'center', margin: '2px 0 12px' }}>
      <div className="timer big" style={{ color: col, fontSize: 'clamp(46px,16vw,64px)' }}>{t && left !== null && left <= 0 ? '+' : ''}{clock(shown)}</div>
      <div className="small mute">{!t ? 'Ready' : brk ? 'Break' : run ? name(t.sub) : 'Paused'} · today {(todaySec / 3600).toFixed(1)} / {s.goalH} h</div>
      <div className="bar" style={{ marginTop: 8 }}><i style={{ width: `${Math.max(0, Math.min(100, (t ? sessF : todaySec / goal) * 100))}%`, background: done ? 'var(--green)' : undefined }} /></div>
    </div>
    <div className="row" style={{ justifyContent: 'center', marginBottom: 10 }}>
      {[['free', 'Stopwatch'], ['custom', 'Countdown']].map(([m, l]) => <button key={m} className={`chip ${(m === 'free') === (s.tmode === 'free') ? 'on' : ''}`} disabled={!!t} onClick={() => set('tmode', m)}>{l}</button>)}
      {!t && s.tmode === 'custom' && <><Num min={1} max={300} value={s.tcustom} onValue={(v) => set('tcustom', v)} style={{ width: 60 }} /><span className="small mute">min</span></>}
      {!t && s.tmode !== 'free' && <><span className="small mute">· break</span><Num min={1} max={60} value={s.breakMin} onValue={(v) => set('breakMin', v)} style={{ width: 54 }} /></>}
    </div>
    <div className="row" style={{ justifyContent: 'center' }}>
      {!brk && <select value={t ? t.sub : s.tsub} onChange={(e) => (t ? api.switchSub(e.target.value) : set('tsub', e.target.value))}>{rows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}
      {!t ? <button className="btn" onClick={api.start}>Start session</button> : <>
        <button className="btn" onClick={run ? api.pause : api.resume}>{run ? 'Pause' : 'Resume'}</button>
        <button className="btn stop" onClick={api.stop}>{brk ? 'End break' : 'Stop & log'}</button>
        <button className="btn ghost" onClick={api.discard}>Discard</button></>}
    </div>
    {t && !brk && <input type="text" placeholder="What are you working on? (optional note)" style={{ width: '100%', marginTop: 10 }} value={t.note || ''} onChange={(e) => set('timer', (x) => ({ ...x, note: e.target.value }))} />}
    {t && done && !t.keep && <div className="toast"><span>{brk ? 'Break over. Ready for the next session?' : 'Session complete. Nice work!'}</span><span className="row">
      {brk ? <><button className="btn sm" onClick={() => { api.stop(); api.start(); }}>Start next</button><button className="btn sm ghost" onClick={api.stop}>Finish</button></>
        : <><button className="btn sm" onClick={api.takeBreak}>Log + {s.breakMin} min break</button><button className="btn sm ghost" onClick={api.keepGoing}>Keep going</button></>}</span></div>}
    {toast && <div className="toast"><span>{toast.msg}</span>{toast.undo && <button className="btn sm ghost" onClick={api.undo}>Undo</button>}</div>}
    <details style={{ marginTop: 10 }}><summary className="small mute" style={{ cursor: 'pointer' }}>Add time manually &amp; tips</summary><div className="small dim" style={{ marginTop: 6 }}>Switching subject mid-session logs the time so far and carries on. Space starts/pauses. Sessions under 1 min are not logged. A running session survives closing the app.</div><Manual rows={rows} api={api} tsub={s.tsub} /></details>
    {list.length > 0 && <div style={{ marginTop: 12 }}><h3>Today's sessions</h3>{list.map((e) => <div key={e.id} className="row small" style={{ padding: '4px 0', borderTop: '1px solid var(--line)' }}>
      <span className="mute" style={{ minWidth: 110 }}>{fmtT(e.start)}–{fmtT(e.end)}</span><span>{name(e.sub)} · {Math.round(e.secs / 60)} min</span>
      <NoteEdit e={e} api={api} />
      <button className="btn sm ghost" title="Delete session" onClick={() => confirm('Delete this session and remove its time from the log?') && api.remove(e.id)}>×</button></div>)}</div>}
  </div>);
}

export function MiniBar({ eng, go }) {
  const { t, total, left, api, name } = eng; if (!t) return null; const run = !!t.runAt;
  return <div className="mini" onClick={go}><b>{left !== null && left <= 0 ? '+' : ''}{clock(left !== null ? Math.abs(left) : total)}</b>
    <span className="small mute" style={{ flex: 1 }}>{t.mode === 'break' ? 'Break' : name(t.sub)}{run ? '' : ' · paused'}</span>
    <button className="btn sm" onClick={(e) => { e.stopPropagation(); run ? api.pause() : api.resume(); }}>{run ? 'Pause' : 'Resume'}</button>
    <button className="btn sm stop" onClick={(e) => { e.stopPropagation(); api.stop(); }}>Stop</button></div>;
}

const Box = ({ l, v, sub }) => <div style={{ flex: '1 1 90px' }}><div className="num" style={{ fontSize: 22 }}>{v}</div><div className="small mute">{l}</div>{sub && <div className="small dim">{sub}</div>}</div>;

export function Stats({ s, rows }) {
  const [view, setView] = useState('week'), [off, setOff] = useState(0), [sel, setSel] = useState(null);
  const today = dkey(), name = (id) => rows.find((r) => r.id === id)?.name || id;
  const range = (o) => {
    const d = new Date(today + 'T12:00:00');
    if (view === 'week') { const mon = addD(today, -((d.getDay() + 6) % 7) + o * 7); return [...Array(7)].map((_, i) => addD(mon, i)); }
    const f = new Date(d.getFullYear(), d.getMonth() + o, 1, 12), n = new Date(f.getFullYear(), f.getMonth() + 1, 0).getDate();
    return [...Array(n)].map((_, i) => dkey(new Date(f.getFullYear(), f.getMonth(), i + 1, 12)));
  };
  const days = range(off), prev = range(off - 1), goal = s.goalH * 3600;
  const val = (k) => (k > today ? 0 : sumO(s.log[k]));
  const tot = days.reduce((a, k) => a + val(k), 0), ptot = prev.reduce((a, k) => a + val(k), 0), dl = tot - ptot;
  const nDays = days.filter((k) => k <= today).length || 1, hit = days.filter((k) => val(k) >= goal).length;
  const best = days.reduce((b, k) => (val(k) > val(b) ? k : b), days[0]), mx = Math.max(goal, ...days.map(val)) * 1.1 || 1;
  const bySub = {}; days.forEach((k) => Object.entries(s.log[k] || {}).forEach(([id, v]) => { bySub[id] = (bySub[id] || 0) + v; }));
  const subs = Object.entries(bySub).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const label = view === 'week' ? `${fmtD(days[0])} – ${fmtD(days[6])}` : new Date(days[0] + 'T12:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const bw = 300 / days.length, pick = (v) => { setView(v); setOff(0); setSel(null); };
  return (<>
    <div className="card">
      <div className="row sb"><h2 style={{ margin: 0 }}>Study insights</h2><div className="row"><button className={`chip ${view === 'week' ? 'on' : ''}`} onClick={() => pick('week')}>Week</button><button className={`chip ${view === 'month' ? 'on' : ''}`} onClick={() => pick('month')}>Month</button></div></div>
      <div className="row sb" style={{ margin: '10px 0' }}><button className="btn sm ghost" onClick={() => { setOff(off - 1); setSel(null); }}>◀</button><b className="small">{label}</b><button className="btn sm ghost" disabled={off >= 0} onClick={() => { setOff(off + 1); setSel(null); }}>▶</button></div>
      <div className="row" style={{ alignItems: 'flex-start', marginBottom: 8 }}>
        <Box l="Total" v={`${(tot / 3600).toFixed(1)} h`} sub={`${dl >= 0 ? '+' : '−'}${Math.abs(dl / 3600).toFixed(1)} h vs previous`} />
        <Box l="Daily average" v={`${(tot / nDays / 3600).toFixed(1)} h`} />
        <Box l="Goal days" v={`${hit}/${days.length}`} sub={`goal ${s.goalH} h`} />
        <Box l="Best day" v={tot ? fmtD(best) : '–'} sub={tot ? `${(val(best) / 3600).toFixed(1)} h` : ''} />
      </div>
      <svg viewBox="0 0 300 130" style={{ width: '100%' }}>
        {days.map((k, i) => { const v = val(k), h = (v / mx) * 100; return <g key={k} onClick={() => setSel(k)} style={{ cursor: 'pointer' }}>
          <rect x={i * bw} y="0" width={bw} height="115" fill="transparent" />
          <rect x={i * bw + bw * .15} y={105 - h} width={bw * .7} height={Math.max(h, v ? 1.5 : 0)} rx="2" fill={v >= goal ? 'var(--green)' : 'var(--amber)'} opacity={sel && sel !== k ? .4 : 1} />
          {(view === 'week' || i === 0 || (i + 1) % 5 === 0) && <text x={i * bw + bw / 2} y="124" textAnchor="middle" fontSize="9" fill="var(--dim)">{view === 'week' ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'][i] : i + 1}</text>}</g>; })}
        <line x1="0" x2="300" y1={105 - (goal / mx) * 100} y2={105 - (goal / mx) * 100} stroke="var(--mute)" strokeDasharray="3 3" strokeWidth=".6" />
      </svg>
      <div className="small mute">{sel ? `${fmtD(sel)} · ${(val(sel) / 3600).toFixed(1)} h${Object.entries(s.log[sel] || {}).map(([id, v]) => ` · ${name(id)} ${Math.round(v / 60)}m`).join('')}` : 'Tap a bar for that day. Dashed line = daily goal; green = goal met.'}</div>
    </div>
    <div className="card"><h3>Where the time went</h3>{subs.length ? subs.map(([id, v]) => <div key={id} style={{ marginBottom: 7 }}><div className="row sb small"><span>{name(id)}</span><span className="mute">{(v / 3600).toFixed(1)} h · {Math.round((v / (tot || 1)) * 100)}%</span></div><Bar v={v / subs[0][1]} /></div>) : <div className="small mute">Nothing logged in this period.</div>}</div>
  </>);
}
const Bar = ({ v }) => <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, (v || 0) * 100))}%` }} /></div>;

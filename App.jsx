import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { SUBJECTS, MARKS_MAP, TESTS } from './data.js';
import { useSync, SyncCard } from './sync.jsx';
import { saveResilient, loadResilient } from './sync-core.js';
import { mastery, DEFAULT_PRIOR } from './readiness-core.js';
import { buildPlan } from './planner.js';
import { PlanView, PlannerSettings } from './plan-ui.jsx';
import { setupNative, saveFile } from './native.js';
import { setupWeb } from './pwa.js';
import { Num, Inline, InlineDate } from './ui.js';
import { rowFor, parseSyllabus, mergeSubjects, countMatches, parseTests, mergeTests, countTestMatches, parsePWFiles, applyPWImport } from './io.js';
import { useTimerEngine, TimerCard, MiniBar, Stats, tSeg, tTotal } from './timer.jsx';

/* ======== merged from extras.jsx ======== */

export const REV_DAYS = [1, 7, 21];
export const MIN_MOCK_N = 3;
export function mockAccByRow(s) {
  const total = ROWS.reduce((a, r) => a + eff(s, r), 0) || 1, out = {};
  ROWS.forEach((r) => { let sc = 0, mx = 0, n = 0; s.mocks.forEach((m) => { const v = m.subj?.[r.id]; if (v == null) return; sc += v; mx += eff(s, r) * (100 / total) * (m.max / 100); n++; }); out[r.id] = n && mx > 0 ? { acc: sc / mx, n, lost: (mx - sc) / n } : null; });
  return out;
}
// A logged test belongs to one subject when its test-series entry maps to exactly one marks-row (e.g. a subject weekly test).
export const testRow = (s, m) => { const x = (s.tests || []).find((q) => q.id === m.test); const rs = new Set(((x && x.sids) || []).map((i) => rowFor(i)).filter(Boolean)); return rs.size === 1 ? [...rs][0] : null; };
const clamp100 = (v) => Math.max(0, Math.min(100, v));
// 0-100 results for one subject. Net marks (after negative marking) over the max, floored at 0.
export function testSamples(s, rowId) {
  const total = ROWS.reduce((a, r) => a + eff(s, r), 0) || 1, row = ROWS.find((r) => r.id === rowId), out = [];
  (s.mocks || []).forEach((m) => {
    const v = m.subj?.[rowId];
    if (v != null) { const mx = eff(s, row) * (100 / total) * (m.max / 100); if (mx > 0) out.push(clamp100((v / mx) * 100)); }
    else if (testRow(s, m) === rowId && m.max > 0) out.push(clamp100((m.score / m.max) * 100));
  });
  return out;
}
/* ── schedule defaults (from your Mission Tracker plan; edit in the Plan tab) ── */
export const SCHED = {
  ga: ['2026-09-01', '2026-12-31'], cprog: ['2026-09-01', '2026-09-30'], ds: ['2026-09-01', '2026-09-30'], algo: ['2026-09-01', '2026-09-30'],
  coa: ['2026-10-01', '2026-10-31'], os: ['2026-10-01', '2026-10-31'], dbms: ['2026-10-01', '2026-10-31'], digital: ['2026-10-01', '2026-10-31'],
  cn: ['2026-11-01', '2026-11-30'], toc: ['2026-11-01', '2026-11-30'], compiler: ['2026-11-01', '2026-11-30'],
  disc: ['2026-12-01', '2026-12-31'], linalg: ['2026-12-01', '2026-12-31'], calc: ['2026-12-01', '2026-12-31'],
};
const RANGE = { ga: '15%', ds: '10-12%', algo: '6-8%', coa: '8-11%', os: '8-10%', dbms: '8%', digital: '4-6%', cn: '8-11%', toc: '8-10%' };
const sch = (s, id) => s.sched?.[id] || SCHED[id] || ['2026-09-01', '2026-12-31'];

export function paceOf(s, r, today = dk()) {
  const [a, b] = sch(s, r.id);
  let d = 0, t = 0;
  s.subjects.filter((x) => x.row === r.id).forEach((x) => x.chapters.forEach((c) => c.lectures.forEach((l) => { t++; if (l.done) d++; })));
  const act = t ? d / t : 0, exp = Math.max(0, Math.min(1, diff(today, a) / Math.max(1, diff(b, a)))), gap = act - exp;
  const status = today < a ? 'upcoming' : t && act >= 1 ? 'done' : today > b ? 'overdue' : gap >= -0.05 ? 'on pace' : 'behind';
  return { a, b, act, exp, gap, status, left: diff(b, today), t };
}
const COLOR = { done: 'var(--green)', 'on pace': 'var(--green)', upcoming: 'var(--dim)', behind: 'var(--amber)', overdue: 'var(--red)' };
const colorOf = (p) => (p.status === 'behind' && p.gap < -0.2 ? 'var(--red)' : COLOR[p.status]);

/* ── revision queue: a fully-ticked chapter gets revisions at +1, +7, +21 days ── */
export function syncRevq(p) {
  const cur = new Map(p.revq.map((r) => [r.key, r])), next = [];
  let ch = false;
  p.subjects.forEach((sub) => sub.chapters.forEach((c) => {
    if (!c.lectures.length || !c.lectures.every((l) => l.done)) return;
    const key = `${sub.id}::${c.name}`, old = cur.get(key);
    if (old) next.push(old); else { ch = true; next.push({ key, sub: sub.name, ch: c.name, base: dk(), done: [false, false, false] }); }
  }));
  return ch || next.length !== p.revq.length ? { ...p, revq: next } : p;
}
const dueRevs = (s, today) => s.revq.map((r) => { const i = r.done.indexOf(false); return i < 0 ? null : { r, i, due: addDays(r.base, REV_DAYS[i]) }; })
  .filter((x) => x && x.due <= today).sort((a, b) => a.due.localeCompare(b.due));

/* ── Plan tab: subjects grouped by urgency; groups are recomputed from today's date + lecture progress ── */
const PL_PH = [['2026-09-01', 'SEP', 'DSA Foundation', '#4A7C6C'], ['2026-10-01', 'OCT', 'Systems', '#C17D3C'], ['2026-11-01', 'NOV', 'Theory', '#A8452F'], ['2026-12-01', 'DEC', 'Math + Revision', '#7B8CDE'], ['2027-01-01', 'JAN', 'Meatgrinder', '#D68A2B']];
const PL_GROUPS = [['overdue', 'OVERDUE'], ['active', 'ACTIVE'], ['upcoming', 'UPCOMING'], ['done', 'DONE']];
const sdy = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'no date');
const pct = (x) => Math.round(x * 100);
const planGroup = (p) => (p.status === 'overdue' ? 'overdue' : p.status === 'done' ? 'done' : p.status === 'upcoming' ? 'upcoming' : 'active');
const leftText = (p) => (p.left > 0 ? `${p.left}d left` : p.left === 0 ? 'ends today' : `${-p.left}d late`);
const statusText = (p) => (p.status === 'upcoming' ? `Starts ${sd(p.a)}` : p.status === 'done' ? 'Done' : p.status === 'overdue' ? `${pct(p.act)}% done` : `${p.status.toUpperCase()} · ${pct(p.act)}% vs ${pct(p.exp)}%`);

// Today's date key. Re-checks every minute and when the app comes back to the foreground, so a tab/app left open
// past midnight moves subjects between groups (Upcoming -> Active -> Overdue) without needing a tap.
function useToday() {
  const [d, setD] = useState(dk());
  useEffect(() => {
    const tick = () => setD(dk());
    const vis = () => { if (!document.hidden) tick(); };
    const id = setInterval(tick, 60000);
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  }, []);
  return d;
}

function DateBtn({ label, value, onChange }) {
  const ref = useRef(null);
  const pick = () => { const i = ref.current; if (!i) return; try { i.showPicker(); } catch { i.focus(); i.click(); } };
  return (
    <div className="pl-date"><span>{label}</span>
      <button type="button" className="dbtn" onClick={pick}>{sdy(value)}
        <input ref={ref} type="date" value={value} tabIndex={-1} onChange={(e) => onChange(e.target.value)} />
      </button>
    </div>);
}

function PlanCard({ p, compact, open, onToggle, onDate, pos, today, wt }) {
  const { r, a, b } = p, col = colorOf(p), w = Math.max(1, pos(b) - pos(a));
  const track = (
    <div className="pl-track">
      <div className="pl-seg" style={{ left: `${pos(a)}%`, width: `${w}%`, background: col }} />
      <div className="pl-fill" style={{ left: `${pos(a)}%`, width: `${Math.max(0, w * p.act)}%`, background: col }} />
      <div className="pl-today" style={{ left: `${pos(today)}%` }} />
    </div>);
  return (
    <div className="pl-card" style={{ '--c': col }}>
      <div className="pl-head" role="button" tabIndex={0} aria-expanded={open} onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}>
        <div className="pl-l1">
          <span className="pl-nm">{r.name}</span>{!compact && r.id === 'ga' && <span className="tag live">FREE</span>}
          <span className="pl-sp" />
          <span className="pill" title="Exam weightage">{wt}</span>
          {compact ? <span className="pl-st">{statusText(p)}</span> : <span className="dim small pl-nw">{leftText(p)}</span>}
        </div>
        {(!compact || open) && <>
          {track}
          <div className="pl-l3 small"><span className="dim">{sd(a)} → {sd(b)}</span>{compact ? <span className="dim">{leftText(p)}</span> : <span className="pl-st">{statusText(p)}</span>}</div>
        </>}
      </div>
      {open && <div className="pl-edit"><DateBtn label="Start" value={a} onChange={(v) => onDate(0, v)} /><DateBtn label="End" value={b} onChange={(v) => onDate(1, v)} /></div>}
    </div>);
}

export function Plan({ s, set }) {
  const today = useToday(), T0 = '2026-08-31', T1 = s.examDate || '2027-02-06', span = Math.max(1, diff(T1, T0));
  const pos = (k) => Math.max(0, Math.min(100, (diff(k, T0) / span) * 100));
  const [openG, setOpenG] = useState({ overdue: true, active: true, upcoming: false, done: false });
  const [openC, setOpenC] = useState({});
  const total = ROWS.reduce((x, r) => x + eff(s, r), 0) || 1;
  const g = { overdue: [], active: [], upcoming: [], done: [] };
  ROWS.map((r) => ({ r, ...paceOf(s, r, today) })).forEach((p) => g[planGroup(p)].push(p));
  g.overdue.sort((x, y) => x.act - y.act); g.upcoming.sort((x, y) => x.a.localeCompare(y.a));
  g.active.sort((x, y) => x.b.localeCompare(y.b) || x.gap - y.gap); g.done.sort((x, y) => x.a.localeCompare(y.a));
  const behindN = g.active.filter((p) => p.status === 'behind').length;
  const meta = {
    overdue: g.overdue.length ? `avg ${pct(g.overdue.reduce((x, p) => x + p.act, 0) / g.overdue.length)}% lectures done` : '',
    active: behindN ? `${behindN} behind` : 'all on pace', upcoming: '', done: '',
  };
  const cur = [...PL_PH].reverse().find(([k]) => k <= today);
  const setD = (id, i, v) => v && set('sched', (o) => { const n = [...(o[id] || SCHED[id] || ['2026-09-01', '2026-12-31'])]; n[i] = v; return { ...o, [id]: n }; });
  return (
    <div className="card">
      <h2>Schedule</h2>
      <div className="mute small">{sd(T0)} → {sd(T1)} · tap a subject to edit its dates. Pills show exam weightage; the white tick is today.</div>
      <div className="pl-pw">
        <div className="pl-phases">{PL_PH.map(([k, m, , c], i) => <div key={k} style={{ width: `${(i === PL_PH.length - 1 ? 100 : pos(PL_PH[i + 1][0])) - (i ? pos(k) : 0)}%`, background: c + '55' }}>{m}</div>)}</div>
        <div className="pl-ptick" style={{ left: `${pos(today)}%` }} />
      </div>
      <div className="small mute" style={{ marginBottom: 12 }}>{cur ? <>Now: <b style={{ color: 'var(--ink)' }}>{cur[2]}</b></> : `Starts ${sd(PL_PH[0][0])}`}</div>
      {PL_GROUPS.map(([k, title]) => g[k].length > 0 && (
        <div key={k}>
          <button className="pl-gh" aria-expanded={!!openG[k]} onClick={() => setOpenG((o) => ({ ...o, [k]: !o[k] }))}>
            <span className="chev">▸</span>{title}<span className="cnt">{g[k].length}</span><span className="gm">{meta[k]}</span>
          </button>
          {openG[k] && g[k].map((p) => (
            <PlanCard key={p.r.id} p={p} compact={k === 'overdue' || k === 'done'} open={!!openC[p.r.id]} pos={pos} today={today}
              wt={RANGE[p.r.id] || `~${Math.round((eff(s, p.r) / total) * 100)}%`}
              onToggle={() => setOpenC((o) => ({ ...o, [p.r.id]: !o[p.r.id] }))} onDate={(i, v) => setD(p.r.id, i, v)} />))}
        </div>))}
    </div>
  );
}

/* ── Today: revisions due, neglect warnings, behind schedule ── */
/* ── Settings ── */
export function Settings({ s, set }) {
  const [bk, setBk] = useState('');
  const G = window.gcc;
  return (
    <div className="card">
      <h3>Settings</h3>
      <div className="grid" style={{ gap: 10 }}>
        <label className="small mute">Theme <select value={s.theme} onChange={(e) => set('theme', e.target.value)}><option value="dark">Dark</option><option value="light">Light</option></select></label>
        <label className="small mute">Neglect warning after <Num min={1} max={30} value={s.neglect} onValue={(v) => set('neglect', v)} /> days</label>
        <label className="small mute"><input type="checkbox" checked={s.notify} onChange={(e) => { set('notify', e.target.checked); if (e.target.checked && window.Notification && Notification.permission === 'default') Notification.requestPermission(); }} /> Daily reminder at <input type="time" value={s.remindAt} onChange={(e) => set('remindAt', e.target.value || '20:00')} /></label>
        {G && <label className="small mute"><input type="checkbox" checked={s.trayClose} onChange={(e) => set('trayClose', e.target.checked)} /> Close button hides to tray (keeps reminders running)</label>}
      </div>
      {G && <div className="row" style={{ marginTop: 10 }}>
        <button className="btn ghost" onClick={async () => setBk('Saved: ' + (await G.backup(JSON.stringify(s))))}>Backup now</button>
        <button className="btn ghost" onClick={() => G.openBackups()}>Open backup folder</button>
      </div>}
      {G && <div className="dim small" style={{ marginTop: 6 }}>Auto-backup every 10 min and on close to Documents\GATE-Command-Center-Backups (last 14 days kept).{bk && <><br />{bk}</>}</div>}
    </div>
  );
}

/* ── Mocks: subject-wise inputs and analysis ── */
export function SubjectInputs({ f, setF }) {
  return (
    <details className="sub" style={{ marginBottom: 10 }}>
      <summary style={{ fontWeight: 600 }}>Subject-wise marks scored (optional)</summary>
      <div className="small mute" style={{ margin: '4px 0 8px' }}>Leave blank for subjects you didn't track.</div>
      <div className="grid" style={{ gap: 6, gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
        {ROWS.map((r) => <label key={r.id} className="row sb small mute">{r.name}<input type="number" step="any" style={{ width: 64 }} value={f.subj?.[r.id] ?? ''} onChange={(e) => setF({ ...f, subj: { ...f.subj, [r.id]: e.target.value } })} /></label>)}
      </div>
    </details>
  );
}

export function SubjectAnalysis({ s }) {
  const today = dk(), macc = mockAccByRow(s);
  const hours = (id) => { let t = 0; for (let i = 0; i < 14; i++) t += s.log[addDays(today, -i)]?.[id] || 0; return t / 3600; };
  const A = ROWS.map((r) => { const m = macc[r.id]; return m ? { r, n: m.n, acc: m.acc, lost: m.lost, h: hours(r.id) } : null; }).filter(Boolean).sort((a, b) => b.lost - a.lost);
  if (!A.length) return null;
  const top = A[0];
  return (
    <div className="card">
      <h3>Subject-wise analysis</h3>
      <table><thead><tr><th>Subject</th><th>Accuracy</th><th>Lost /mock</th><th>14d hrs</th><th>Tests</th></tr></thead><tbody>
        {A.map((x) => <tr key={x.r.id}><td>{x.r.name}</td><td style={{ color: x.acc < 0.5 ? 'var(--red)' : x.acc < 0.7 ? 'var(--amber)' : 'var(--green)' }}>{Math.round(x.acc * 100)}%</td><td>{x.lost.toFixed(1)}</td><td>{x.h.toFixed(1)}</td><td>{x.n}</td></tr>)}
      </tbody></table>
      <div className="small" style={{ marginTop: 8 }}><b>Biggest leak: {top.r.name}</b> <span className="mute">— about {top.lost.toFixed(1)} marks per mock{top.h < 3 ? `, and only ${top.h.toFixed(1)} h studied in the last 14 days` : ''}.</span></div>
    </div>
  );
}

/* ── theme, prefs, auto-backup, reminders, tray tooltip ── */
export function usePolish(s, setS) {
  const ref = useRef(s); ref.current = s;
  useEffect(() => { document.documentElement.dataset.theme = s.theme; window.gcc?.prefs({ trayClose: s.trayClose, theme: s.theme }); }, [s.theme, s.trayClose]);
  useEffect(() => {
    const G = window.gcc; if (!G) return;
    const run = () => G.backup(JSON.stringify(ref.current)).catch(() => {});
    run(); const i = setInterval(run, 6e5); window.addEventListener('beforeunload', run);
    return () => { clearInterval(i); window.removeEventListener('beforeunload', run); };
  }, []);
  useEffect(() => {
    if (window.gcc && window.Notification && Notification.permission === 'default') Notification.requestPermission(); // desktop app only; the web asks when you turn reminders on
    const tick = () => {
      const c = ref.current, now = new Date(), today = dk(now);
      const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      let sec = sumO(c.log[today]); if (c.timer && c.timer.mode !== 'break' && dk(new Date(c.timer.ts)) === today) sec += tSeg(c.timer, Date.now());
      window.gcc?.tray(c.timer ? `Focus ${c.timer.runAt === null ? 'paused' : 'running'} · ${Math.floor(tTotal(c.timer, Date.now()) / 60)} min` : `Today ${(sec / 3600).toFixed(1)}h of ${c.goalH}h`);
      if (c.notify && hm >= c.remindAt && c.lastRemind !== today && window.Notification && Notification.permission === 'granted') {
        const n = dueRevs(c, today).length;
        const body = `${(sec / 3600).toFixed(1)} of ${c.goalH} h studied today · ${n} revision${n === 1 ? '' : 's'} due`;
        try { const note = new Notification('GATE Command Center', { body }); note.onclick = () => window.gcc?.show(); }
        catch { navigator.serviceWorker?.ready.then((r) => r.showNotification('GATE Command Center', { body, icon: 'icon-192.png' })).catch(() => {}); } // Android browsers only allow notifications via the service worker
        setS((p) => ({ ...p, lastRemind: today }));
      }
    };
    tick(); const i = setInterval(tick, 3e4); return () => clearInterval(i);
  }, []);
}


/* ── TBA subjects (PW hasn't scheduled these yet; chapters are provisional) ── */
const LEGACY_SELF_STUDY_IDS = ['ds', 'algo', 'cn', 'compiler'];
// These four are PW-unannounced subjects kept in the live category (not a separate TBA type);
// lecture counts are added manually once each is announced. This also reverts any earlier TBA tagging.
export function migrateTba(p) {
  return { ...p, subjects: p.subjects.map((x) => (LEGACY_SELF_STUDY_IDS.includes(x.id) && x.type !== 'rec' ? { ...x, type: 'live' } : x)) };
}
const CAT_LABEL = { live: 'LIVE', rec: 'RECORDED' };
export const catLabel = (t) => CAT_LABEL[t] || 'LIVE';

/* ── readable (.md) export ── */
export function readableSummary(s, R, today) {
  const L = [`# GATE CSE 2027 — ${today}`, '', `Days to exam (${s.examDate}): ${Math.max(0, diff(s.examDate, dk()))}`,
    `Days to syllabus-complete target (${s.targetDate}): ${Math.max(0, diff(s.targetDate, dk()))}`,
    `Weighted readiness: ${(R.pct*100).toFixed(1)}% (${R.marks.toFixed(0)} marks, target ${s.target})`, '', '## Subjects'];
  R.rows.forEach((r) => L.push(`- ${r.name}: ${r.d}/${r.t} lectures, PYQ attempted ${Math.round((r.pyq||0)*100)}%, test score ${r.rev == null ? 'no data' : Math.round(r.rev*100)+'%'} → mastery ${(r.score*100).toFixed(0)}% (${r.label}${r.urgent ? ', URGENT' : ''})`));
  if (s.mocks.length) { L.push('', '## Mocks'); [...s.mocks].slice(-5).forEach((m) => L.push(`- ${m.date} ${m.name}: ${m.score}/${m.max}`)); }
  const due = (s.revq || []).filter((r) => r.done.includes(false));
  if (due.length) { L.push('', '## Revision queue'); due.forEach((r) => L.push(`- ${r.sub} · ${r.ch}`)); }
  return L.join('\n');
}

/* ── per-subject Gantt: start, syllabus-end, revision-done-by ── */
export function SubjectGantt({ s, set }) {
  const today = dk(), T0 = '2026-08-31', T1 = s.examDate || '2027-02-06', span = diff(T1, T0);
  const pos = (k) => Math.max(0, Math.min(100, (diff(k, T0) / span) * 100));
  const rows = sortSubjects(s.subjects.filter((x) => x.chapters.some((c) => c.lectures.length)));
  const g = (id) => s.gantt?.[id] || {};
  const setG = (id, k, v) => v && set('gantt', (o) => ({ ...o, [id]: { start: '2026-09-01', end: '2026-11-30', rev: '2027-01-15', ...o[id], [k]: v } }));
  return (
    <details className="sub" style={{ marginBottom: 10 }}>
      <summary style={{ fontWeight: 600 }}>Gantt: start → syllabus end → revision done by</summary>
      {rows.map((x, xi) => {
        const d = { start: '2026-09-01', end: '2026-11-30', rev: '2027-01-15', ...g(x.id) };
        return (
          <React.Fragment key={x.id}>
          <GroupHead prev={rows[xi - 1]} cur={x} />
          <div style={{ margin: '10px 0' }}>
            <div className="small" style={{ marginBottom: 3 }}>{x.name}</div>
            <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
              <input type="date" style={{ width: 118 }} value={d.start} onChange={(e) => setG(x.id, 'start', e.target.value)} />
              <div className="track">
                <div className="seg" style={{ left: `${pos(d.start)}%`, width: `${Math.max(1, pos(d.end) - pos(d.start))}%`, background: 'var(--amber)' }} />
                <div className="seg" style={{ left: `${pos(d.end)}%`, width: `${Math.max(1, pos(d.rev) - pos(d.end))}%`, background: 'var(--blue)', opacity: 0.5 }} />
                <div className="today" style={{ left: `${pos(today)}%` }} />
              </div>
              <input type="date" style={{ width: 118 }} value={d.end} onChange={(e) => setG(x.id, 'end', e.target.value)} />
              <input type="date" style={{ width: 118 }} value={d.rev} onChange={(e) => setG(x.id, 'rev', e.target.value)} />
            </div>
          </div>
          </React.Fragment>);
      })}
      <div className="dim small">amber = study window · blue = buffer to revision-done-by date</div>
    </details>
  );
}

/* ── smart readiness calculator: editable coverage/PYQ/revision weights ── */
/* ── one-time: split the old combined "Discrete Maths + Probability" into two subjects ── */
export function splitDiscProb(p) {
  if (p.discProbSplit) return p;
  let subjects = p.subjects;
  if (!subjects.some((x) => x.row === 'prob' || x.id === 'probstat')) {
    subjects = [...subjects, { id: 'probstat', name: 'Probability and Statistics', type: 'rec', row: 'prob', chapters: [{ name: 'Probability Basics', lectures: [{ name: 'Lectures done' }] }] }];
  }
  return { ...p, discProbSplit: true, subjects };
}


/* ── one-time migration: Discrete Mathematics (Live) subject + Gantt schedule dates ── */
export function ganttMigrate(p) {
  if (p.ganttV3) return p;
  const subjects = [...p.subjects];
  if (!subjects.some((x) => x.id === 'discl')) {
    const i = subjects.findIndex((x) => x.id === 'engmaths');
    subjects.splice(i < 0 ? subjects.length : i + 1, 0, { id: 'discl', name: 'Discrete Mathematics (Live)', type: 'live', row: 'disc', chapters: [{"name": "Mathematical Logic", "lectures": [{"name": "Lectures done", "date": "-", "done": false}]}, {"name": "Set Theory & Relations", "lectures": [{"name": "Lectures done", "date": "-", "done": false}]}, {"name": "Functions & Algebraic Structures", "lectures": [{"name": "Lectures done", "date": "-", "done": false}]}, {"name": "Combinatorics", "lectures": [{"name": "Lectures done", "date": "-", "done": false}]}, {"name": "Graph Theory", "lectures": [{"name": "Lectures done", "date": "-", "done": false}]}] });
  }
  const S = {"ga": {"start": "2026-09-01", "end": "2026-10-10"}, "dbms": {"start": "2026-10-01", "end": "2026-10-09"}, "toc": {"start": "2026-10-01", "end": "2026-10-09"}, "cprog": {"start": "2026-10-01", "end": "2026-10-11"}, "fundc": {"start": "2026-10-01", "end": "2026-10-11"}, "bcs": {"start": "2026-10-01", "end": "2026-10-11"}, "os": {"start": "2026-10-01", "end": "2026-10-23"}, "compiler": {"start": "2026-10-12", "end": "2026-10-30"}, "ds": {"start": "2026-10-12", "end": "2026-11-06"}, "coa": {"start": "2026-10-12", "end": "2026-11-15"}, "algo": {"start": "2026-11-09", "end": "2026-12-25"}, "cn": {"start": "2026-11-01", "end": "2026-12-31"}, "engmaths": {"start": "2026-10-26", "end": "2026-12-12"}, "discl": {"start": "2026-10-26", "end": "2026-12-12"}, "probstat": {"start": "2026-10-26", "end": "2026-12-31"}, "linear": {"start": "2026-12-13", "end": "2026-12-22"}, "calculus": {"start": "2026-12-23", "end": "2026-12-31"}};
  const gantt = { ...(p.gantt || {}) };
  for (const k in S) gantt[k] = { rev: '2027-01-15', ...gantt[k], ...S[k] };
  return { ...p, ganttV3: true, subjects, gantt };
}

/* ── grouping: Technical / Math & Aptitude (Gantt, Syllabus); Technical / Aptitude / Mathematics (Readiness) ── */
const ORDER = ["dbms", "toc", "cprog", "fundc", "bcs", "os", "compiler", "ds", "coa", "algo", "cn", "digital", "ga", "engmaths", "discl", "probstat", "linear", "calculus"];
const MATH_IDS = new Set(["ga", "engmaths", "discl", "probstat", "linear", "calculus"]);
const READY_MATH = ['disc', 'prob', 'linalg', 'calc'];
export const sortSubjects = (list) => {
  const k = (x) => (MATH_IDS.has(x.id) ? 100 : 0) + (ORDER.indexOf(x.id) < 0 ? 99 : ORDER.indexOf(x.id));
  return [...list].sort((a, b) => k(a) - k(b));
};
export const sortReadyRows = (rows) => {
  const T = rows.filter((r) => r.id !== 'ga' && !READY_MATH.includes(r.id)).sort((a, b) => b.marks - a.marks);
  const A = rows.filter((r) => r.id === 'ga');
  const M = rows.filter((r) => READY_MATH.includes(r.id)).sort((a, b) => b.marks - a.marks);
  return [...T, ...A, ...M];
};
const readySec = (r) => (r.id === 'ga' ? 'A' : READY_MATH.includes(r.id) ? 'M' : 'T');
export function GroupHead({ prev, cur, ready }) {
  const same = prev && (ready ? readySec(prev) === readySec(cur) : MATH_IDS.has(prev.id) === MATH_IDS.has(cur.id));
  if (same) return null;
  const label = ready ? { T: 'TECHNICAL', A: 'APTITUDE', M: 'MATHEMATICS' }[readySec(cur)] : MATH_IDS.has(cur.id) ? 'MATH & APTITUDE' : 'TECHNICAL';
  return <div style={{ fontWeight: 700, fontSize: 12, letterSpacing: '.06em', margin: '16px 0 4px', color: 'var(--amber)' }}>{label}</div>;
}


/* ── 2. Mock score trend: dependency-free inline SVG line chart ── */
export function MockTrend({ s }) {
  const M = [...s.mocks].sort((a, b) => a.date.localeCompare(b.date));
  if (M.length < 2) return null;
  const W = 600, H = 140, P = 24;
  const pts = M.map((m, i) => ({ x: P + (i * (W - 2 * P)) / (M.length - 1), y: H - P - ((Math.min(100, (m.score / m.max) * 100)) / 100) * (H - 2 * P), v: (m.score / m.max) * 100 }));
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const avgY = H - P - (pts.reduce((a, p) => a + p.v, 0) / pts.length / 100) * (H - 2 * P);
  return (
    <div className="card">
      <h3>Mock score trend</h3>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <line x1={P} y1={avgY} x2={W - P} y2={avgY} stroke="var(--line)" strokeDasharray="4 4" />
        <path d={path} fill="none" stroke="var(--amber)" strokeWidth="2" />
        {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3" fill="var(--amber)" />)}
      </svg>
      <div className="dim small">Dashed line = average ({(pts.reduce((a, p) => a + p.v, 0) / pts.length).toFixed(0)}%). Last: {pts[pts.length - 1].v.toFixed(0)}%, first: {pts[0].v.toFixed(0)}%.</div>
    </div>
  );
}

/* ======== end merged extras.jsx ======== */

/* ───────── constants & helpers ───────── */
const KEY = 'gcc2027_v1';
const ROWS = MARKS_MAP;
const DEF = { log: {}, timer: null, tsub: 'os', tmode: 'free', tcustom: 45, breakMin: 5, sessions: [], pyq: {}, rev: {}, marks: {}, mocks: [], rules: {}, target: 65, goalH: 6, sched: {}, revq: [], theme: 'dark', notify: true, remindAt: '20:00', lastRemind: '', neglect: 5, trayClose: true, targetDate: '2026-12-31', examDate: '2027-02-06', rule1Min: 30, rule2Target: 1, gantt: {}, plan: {}, schemaVersion: 10, weights: { cov: 40, pyq: 30, rev: 30 }, urgent: {}, tPrior: 50, tbaMigrated: false };
const seed = (done) => SUBJECTS.map((x) => ({
  id: x.id, name: x.name, type: x.type === 'rec' ? 'rec' : 'live', row: rowFor(x.id), ...(x.start ? { start: x.start } : {}), ...(x.end ? { end: x.end } : {}),
  chapters: x.chapters.map((c, ci) => ({ ...c, name: c.name, lectures: c.lectures.map((l, li) => ({ ...l, done: !!done[`${x.id}__${ci}__${li}`] })) })),
}));
const hydrate = (p) => {
  const s = { ...DEF, ...p };
  if (!Array.isArray(p.subjects)) s.subjects = seed(p.done || {});
  if (!Array.isArray(p.tests)) s.tests = TESTS.map((t) => ({ ...t }));
  delete s.done;
  return s;
};
// One-time: bring saved v7 data up to the v8 dataset (18 subjects, 88 tests, Digital Logic skipped) without losing ticks.
const V7_TEST_IDS = new Set(["swt9","swt10","swt11","swt12","mst1","mst2","mst3","mst4","gbg1","pyq22","pyq23","pyq24","gbg2","gbg3","gbg4","pyq25","pyq26","gbg5","gbg6","gbg7","gbg8","gbg9","gbg10","gbg11","gbg12"]["swt9","swt10","swt11","swt12","mst1","mst2","mst3","mst4","gbg1","pyq22","pyq23","pyq24","gbg2","gbg3","gbg4","pyq25","pyq26","gbg5","gbg6","gbg7","gbg8","gbg9","gbg10","gbg11","gbg12"]);
export function dataV9(p) {
  if (p.dataV9) return p;
  const old = new Map((p.subjects || []).map((x) => [x.id, x]));
  const subjects = seed({}).map((ns) => {
    const o = old.get(ns.id); if (!o) return ns;
    return { ...ns, chapters: ns.chapters.map((c, ci) => {
      const oc = o.chapters.find((x) => x.name === c.name) || (o.chapters.length === ns.chapters.length ? o.chapters[ci] : null); if (!oc) return c;
      return { ...c, lectures: c.lectures.map((l, li) => { const ol = oc.lectures.find((x) => x.name === l.name) || oc.lectures[li]; return ol ? { ...l, done: !!(ol.done || l.done), ...(ol.pyq ? { pyq: true } : {}), ...(ol.dpp && !l.dpp ? { dpp: ol.dpp } : {}) } : l; }) };
    }) };
  });
  (p.subjects || []).filter((x) => !SUBJECTS.some((n) => n.id === x.id) && x.id !== 'digital').forEach((x) => subjects.push(x));   // keep your custom subjects
  const ts = Array.isArray(p.tests) ? p.tests.filter((t) => !V7_TEST_IDS.has(t.id) && !TESTS.some((n) => n.id === t.id)) : [];
  return { ...p, dataV9: true, subjects, tests: [...TESTS.map((t) => ({ ...t })), ...ts] };
}
const normalize = (o) => migrateTba(ganttMigrate(splitDiscProb(dataV9(hydrate(o || {})))));
const load = () => normalize(loadResilient(localStorage, KEY).v);
const dkey = (d = new Date()) => new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
// accepts a 'YYYY-MM-DD' key (exact, timezone-safe) or a Date
const daysTo = (d) => Math.max(0, typeof d === 'string' ? diff(d, dkey()) : Math.ceil((d - new Date().setHours(0, 0, 0, 0)) / 864e5));
const clock = (sec) => { sec = Math.floor(sec); const p = (n) => String(n).padStart(2, '0'); return `${p(Math.floor(sec / 3600))}:${p(Math.floor(sec / 60) % 60)}:${p(sec % 60)}`; };
const hrs = (sec) => (sec / 3600).toFixed(1);
const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
const shortDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'no date');
// aliases used by the merged extras.jsx helpers below
const dk = dkey, sumO = sum, sd = shortDate;
const at = (k) => new Date(k + 'T12:00:00');
const addDays = (k, n) => { const d = at(k); d.setDate(d.getDate() + n); return dk(d); };
const diff = (a, b) => Math.round((at(a) - at(b)) / 864e5);
const download = (name, data) => saveFile(name, JSON.stringify(data, null, 2), 'application/json').catch(() => {});
const TIER_COLOR = { 'Tier 1': 'var(--amber)', 'Tier 2': 'var(--blue)', 'Tier 3': 'var(--green)' };
const CATS = [['concept', 'Concept gap'], ['calc', 'Calculation error'], ['time', 'Time pressure'], ['silly', 'Silly mistake']];
const CUTOFFS = [
  { label: 'IIT Top', sub: 'Bombay / Delhi / Madras CSE', min: 75, color: 'var(--blue)' },
  { label: 'IIT Tier-2', sub: 'Patna / Mandi / Jammu', min: 65, color: 'var(--green)' },
  { label: 'NIT Tier-1', sub: 'Trichy / Warangal / Surathkal', min: 55, color: 'var(--green)' },
  { label: 'NIT Tier-2 / PSU', sub: 'Mid-tier NITs, PSU eligible', min: 45, color: 'var(--amber)' },
  { label: 'Qualifying', sub: 'Valid scorecard', min: 29, color: 'var(--amber)' },
  { label: 'Below cutoff', sub: 'Under qualifying mark', min: 0, color: 'var(--red)' },
];
const CHECKPOINTS = [
  { by: '2026-11-13', label: 'Week 8: first +3–5 improvement over baseline', min: null },
  { by: '2026-12-18', label: 'Week 12: mocks should be 55–65', min: 55 },
  { by: '2027-01-08', label: 'Week 15: mocks should be 70–75', min: 70 },
];

const effMarks = (s, r) => s.marks?.[r.id] ?? r.marks;
const eff = effMarks; // alias used by merged extras.jsx helpers
function rowStats(row, s) {
  let d = 0, t = 0, pq = 0;
  s.subjects.filter((x) => x.row === row.id).forEach((x) => x.chapters.forEach((c) => c.lectures.forEach((l) => { t++; if (l.done) d++; if (l.pyq) pq++; })));
  const cov = t ? d / t : 0, pyq = t ? pq / t : 0;
  const m = mastery({ C: cov * 100, P: pyq * 100, tests: testSamples(s, row.id), w: s.weights || { cov: 40, pyq: 30, rev: 30 }, prior: s.tPrior ?? DEFAULT_PRIOR });
  return { d, t, pq, cov, pyq, rev: m.T == null ? null : m.T / 100, mockN: m.n, raw: m.raw / 100, score: m.M / 100, label: m.label, urgent: !!(s.urgent || {})[row.id] };
}
function readiness(s) {
  const total = ROWS.reduce((a, r) => a + effMarks(s, r), 0) || 1;
  const rows = ROWS.map((r) => ({ ...r, marks: effMarks(s, r), ...rowStats(r, s) }));
  const pct = rows.reduce((a, r) => a + r.marks * r.score, 0) / total;
  return { rows, pct, marks: pct * 100, total };
}
const norm = (m) => (m.score / m.max) * 100;
function useNow(on) {
  const [n, setN] = useState(Date.now());
  useEffect(() => { if (!on) return; const i = setInterval(() => setN(Date.now()), 1000); return () => clearInterval(i); }, [on]);
  return n;
}
const Bar = ({ v, c = '' }) => <div className={`bar ${c}`}><i style={{ width: `${Math.max(0, Math.min(100, (v || 0) * 100))}%` }} /></div>;

/* ───────── app ───────── */
function App() {
  const [s, setS] = useState(load);
  const [tab, setTab] = useState('today');
  const [panel, setPanel] = useState(false);
  const [saveErr, setSaveErr] = useState(false);
  useEffect(() => { const r = saveResilient(localStorage, KEY, s); setSaveErr(!r.ok); if (!r.ok) console.error('SAVE FAILED', r.why); }, [s]);
  const set = (k, v) => setS((p) => ({ ...p, [k]: typeof v === 'function' ? v(p[k]) : v }));
  usePolish(s, setS);
  const eng = useTimerEngine({ s, setS, set, tab, rows: ROWS });
  const sync = useSync(s, setS, () => normalize({}));
  useEffect(() => { setupWeb(); }, []);
  useEffect(() => { setupNative(s); }, [s.notify, s.remindAt]);
  useEffect(() => { setS(syncRevq); }, [s.subjects]);
  const tabs = [['today', 'Today'], ['syllabus', 'Syllabus'], ['ready', 'Readiness'], ['tests', 'Tests']];
  return (
    <div className="shell">
      <main><div className="wrap">
        {saveErr && <div className="card" role="alert" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>Couldn't save to this device (storage full or blocked). Open ⚙ and export a backup now.</div>}
        {tab === 'today' && <><Today s={s} set={set} setS={setS} sync={sync} eng={eng} /><h2 style={{ margin: '18px 2px 8px' }}>Plan</h2><Plan s={s} set={set} /></>}
        {tab === 'syllabus' && <Syllabus s={s} set={set} />}
        {tab === 'ready' && <><Ready s={s} set={set} /><h2 style={{ margin: '18px 2px 8px' }}>Stats &amp; history</h2><Stats s={s} rows={ROWS} /></>}
        {tab === 'tests' && <Mocks s={s} set={set} />}
      </div></main>
      {tab !== 'today' && <MiniBar eng={eng} go={() => setTab('today')} />}
      {panel && <div className="sheet" onClick={() => setPanel(false)}><div className="sheetin" onClick={(e) => e.stopPropagation()}>
        <div className="row sb" style={{ marginBottom: 12 }}><h2 style={{ margin: 0 }}>Settings &amp; data</h2><button className="btn sm ghost" onClick={() => setPanel(false)}>Close</button></div>
        <Settings s={s} set={set} /><PlannerSettings s={s} set={set} /><SyncCard sync={sync} /><ImportFromPW s={s} setS={setS} /><DataCard s={s} setS={setS} />
      </div></div>}
      <nav>{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}<button className="gearbtn" title="Settings & data" onClick={() => setPanel(true)}>⚙</button></nav>
    </div>
  );
}

/* ───────── Today: timer + daily log ───────── */
function Today({ s, set, setS, sync, eng }) {
  const today = dkey();
  const tm = eng.t, elapsed = tm && tm.mode !== 'break' ? tSeg(tm, eng.now) : 0;
  const logToday = { ...(s.log[today] || {}) };
  if (elapsed && dkey(new Date(tm.ts)) === today) logToday[tm.sub] = (logToday[tm.sub] || 0) + elapsed;
  const todaySec = sum(logToday), goal = s.goalH * 3600;
  const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); const k = dkey(d); return [k, k === today ? todaySec : sum(s.log[k])]; });
  let streak = 0;
  for (let i = 0; i < 400; i++) { const d = new Date(); d.setDate(d.getDate() - i); const k = dkey(d); const v = k === today ? todaySec : sum(s.log[k]); if (v >= 1800) streak++; else if (i > 0) break; }
  const gaOk = (logToday.ga || 0) >= s.rule1Min * 60, pyqCount = s.rules[today]?.pyqCount || 0, pyqOk = pyqCount >= s.rule2Target;
  const R = useMemo(() => readiness(s), [s.subjects, s.mocks, s.marks, s.weights, s.log, s.sched]);
  const grp = (id) => (id === 'ga' ? 'ga' : READY_MATH.includes(id) ? 'ma' : 'core');
  const P = useMemo(() => buildPlan({
    today, targetDate: s.targetDate, examDate: s.examDate, goalH: s.goalH, subjects: s.subjects, tests: s.tests, mocks: s.mocks,
    revDue: dueRevs(s, today).map(({ r, i, due }) => ({ key: r.key, sub: r.sub, ch: r.ch, i, late: Math.max(0, diff(today, due)) })),
    log: { ...s.log, [today]: logToday },
    rows: R.rows.map((r) => ({ id: r.id, name: r.name, marks: r.marks, group: grp(r.id) })),
    sched: Object.fromEntries(ROWS.map((r) => [r.id, sch(s, r.id)])),
    mastery: Object.fromEntries(R.rows.map((r) => [r.id, r.score])),
    urgent: s.urgent || {}, plan: s.plan, neglectDays: s.neglect,
    goalMin: { ga: s.tGA || 60, ma: s.tMA || 60, core: s.tCORE || 180 }, pyq: { count: pyqCount, goal: s.pyqGoal || 10 },
  }), [today, Math.floor(todaySec / 60), R, s.subjects, s.tests, s.mocks, s.revq, s.log, s.plan, s.sched, s.targetDate, s.examDate, s.goalH, s.urgent, s.neglect, s.tGA, s.tMA, s.tCORE, s.pyqGoal, pyqCount]);

  return (<>
    <div className="card">
      <div className="row sb" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><div style={{ minWidth: 0 }}><div className="num">{daysTo(s.targetDate)}</div><div className="mute small" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>days to syllabus completion · <InlineDate value={s.targetDate} onChange={(v) => set('targetDate', v)} fmt={sdy} /></div></div>
        <div style={{ textAlign: 'right' }}><div className="num" style={{ color: 'var(--amber)' }}>{R.marks.toFixed(0)}<span className="mute small"> / {s.target}</span></div><div className="mute small">syllabus-implied marks vs target</div></div></div>
      <div className="row sb small mute" style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
        <span>GATE exam · <InlineDate value={s.examDate} onChange={(v) => set('examDate', v)} fmt={sdy} /></span>
        <span>{daysTo(s.examDate)}d left</span>
      </div>
    </div>

    <TimerCard s={s} set={set} eng={eng} rows={ROWS} todaySec={sum(logToday)} />

    <PlanView P={P} s={s} set={set} />

    <div className="card">
      <div className="row sb"><h3>Time and PYQs today</h3><span className="mute small">goal <Inline min={1} max={16} value={s.goalH} onValue={(v) => set('goalH', v)} /> h · streak {streak}d</span></div>
      {[['ga', 'General Aptitude', 'tGA', 60], ['ma', 'Engineering Maths', 'tMA', 60], ['core', 'Core subjects', 'tCORE', 180]].map(([g, label, key, def]) => {
        const mins = Math.round(Object.entries(logToday).filter(([id]) => (id === 'ga' ? 'ga' : READY_MATH.includes(id) ? 'ma' : 'core') === g).reduce((a, [, v]) => a + v, 0) / 60), goalM = s[key] || def;
        return <div key={g} style={{ marginTop: 10 }}><div className="row sb small"><span>{label}</span><span className="mute">{mins} / <Inline min={5} max={600} value={goalM} onValue={(v) => set(key, v)} style={{ width: 54 }} /> min</span></div><Bar v={mins / goalM} c={mins >= goalM ? 'g' : ''} /></div>;
      })}
      <div className="row sb" style={{ marginTop: 14, flexWrap: 'nowrap' }}>
        <div><b>PYQs today</b> <span className="mute small">goal <Inline min={1} max={200} value={s.pyqGoal || 10} onValue={(v) => set('pyqGoal', v)} style={{ width: 48 }} /></span></div>
        <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
          <button className="btn ghost" aria-label="One less" onClick={() => set('rules', (r) => ({ ...r, [today]: { ...r[today], pyqCount: Math.max(0, pyqCount - 1) } }))}>−</button>
          <b style={{ minWidth: 28, textAlign: 'center', fontSize: 18 }}>{pyqCount}</b>
          <button className="btn ghost" aria-label="One more" onClick={() => set('rules', (r) => ({ ...r, [today]: { ...r[today], pyqCount: pyqCount + 1 } }))}>+</button>
        </div>
      </div>
      <Bar v={pyqCount / (s.pyqGoal || 10)} c={pyqCount >= (s.pyqGoal || 10) ? 'g' : ''} />
      <div className="row" style={{ alignItems: 'flex-end', height: 56, gap: 6, marginTop: 14 }}>
        {days.map(([k, v]) => <div key={k} style={{ flex: 1, textAlign: 'center' }}><div style={{ height: Math.max(3, Math.min(40, (v / goal) * 40)), background: v >= goal ? 'var(--green)' : 'var(--amber)', borderRadius: 3 }} /><div className="dim small">{new Date(k + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'narrow' })}</div></div>)}
      </div>
      <div className="mute small" style={{ marginTop: 4 }}>Week {hrs(days.reduce((a, d) => a + d[1], 0))} h · bars turn green at your daily goal</div>
    </div>


  </>);
}

/* ───────── Import from PW Extension ───────── */
function ImportFromPW({ s, setS }) {
  const [phase, setPhase] = useState('idle'); // idle | preview | done
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState('');
  const [inclTicks, setInclTicks] = useState(true);
  const [inclTests, setInclTests] = useState(true);
  const [dropping, setDropping] = useState(false);

  const readFiles = async (fileList) => {
    setErr(''); setPhase('idle');
    const loaded = [];
    for (const f of fileList) {
      if (!f.name.endsWith('.json')) continue;
      try { loaded.push({ name: f.name, text: await f.text() }); } catch {}
    }
    if (!loaded.length) { setErr('No .json files found. Drop your PW-GATE/data/ folder contents here.'); return; }
    try {
      const p = parsePWFiles(loaded, s.subjects, s.tests || []);
      setPreview(p);
      setPhase(p.hasData ? 'preview' : 'empty');
    } catch (e) { setErr('Could not read files: ' + e.message); }
  };

  const onDrop = (e) => {
    e.preventDefault(); setDropping(false);
    const items = [...(e.dataTransfer.items || [])];
    const files = items.length
      ? items.filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean)
      : [...e.dataTransfer.files];
    readFiles(files);
  };

  const apply = () => {
    const { subjects, tests } = applyPWImport(preview, s.subjects, s.tests || [], { includeTicks: inclTicks, includeTests: inclTests });
    setS((p) => ({ ...p, subjects, tests }));
    setPhase('done');
  };

  const reset = () => { setPhase('idle'); setPreview(null); setErr(''); };

  const zone = {
    border: `2px dashed ${dropping ? 'var(--amber)' : 'var(--line)'}`,
    borderRadius: 10, padding: '22px 14px', textAlign: 'center', cursor: 'pointer',
    background: dropping ? 'color-mix(in srgb,var(--amber) 8%,transparent)' : 'transparent',
    transition: 'all .15s',
  };

  return (
    <div className="card">
      <h3 style={{ margin: '0 0 4px' }}>Import from PW extension</h3>
      <div className="small mute" style={{ marginBottom: 10 }}>
        Drop your <code>PW-GATE/data/</code> folder files (or pick them) to tick completed lectures and sync your test list.
        Ticks already in the app are never removed.
      </div>

      {phase === 'idle' && <>
        <div style={zone}
          onDragOver={(e) => { e.preventDefault(); setDropping(true); }}
          onDragLeave={() => setDropping(false)}
          onDrop={onDrop}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>📂</div>
          <div className="mute small">Drop <b>data/</b> folder files here</div>
          <div className="mute small" style={{ marginTop: 4 }}>or</div>
          <label className="btn ghost" style={{ marginTop: 8, display: 'inline-block', cursor: 'pointer' }}>
            Pick files
            <input type="file" accept=".json" multiple hidden onChange={(e) => readFiles([...e.target.files])} />
          </label>
        </div>
        {err && <div className="small" style={{ color: 'var(--red)', marginTop: 8 }}>{err}</div>}
        <div className="small mute" style={{ marginTop: 8 }}>
          Files: <code>index.json</code>, <code>dashboard.json</code>, <code>tests-batch.json</code>, <code>tests-series.json</code>, and any <code>chapters/*.json</code>
        </div>
      </>}

      {phase === 'empty' && <>
        <div className="small" style={{ color: 'var(--amber)', margin: '8px 0' }}>
          Files read ({preview?.chaptersRead} chapter{preview?.chaptersRead !== 1 ? 's' : ''}, dashboard {preview?.dashboard ? '✓' : '–'}) but nothing new to apply —
          all lectures are already ticked or no done status found.
        </div>
        <button className="btn ghost" onClick={reset}>Try again</button>
      </>}

      {phase === 'preview' && preview && <>
        {/* Summary chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {preview.dashboard && <span className="tag">Dashboard {preview.dashboard.date}</span>}
          <span className="tag">{preview.chaptersRead} chapter file{preview.chaptersRead !== 1 ? 's' : ''}</span>
          {preview.totalToTick > 0 && <span className="tag live">+{preview.totalToTick} lecture{preview.totalToTick !== 1 ? 's' : ''} to tick</span>}
          {preview.newTestCount > 0 && <span className="tag">+{preview.newTestCount} new tests</span>}
          {preview.updTestCount > 0 && <span className="tag">{preview.updTestCount} tests update</span>}
        </div>

        {/* Tick preview */}
        {preview.deltas.length > 0 && <>
          <div className="small mute" style={{ marginBottom: 4 }}>Lectures to tick (PW says done; already-ticked are skipped)</div>
          <div className="card" style={{ padding: '4px 12px', marginBottom: 10, maxHeight: 200, overflowY: 'auto' }}>
            {preview.deltas.map((d, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '5px 0', borderTop: i ? '1px solid var(--line)' : 'none', alignItems: 'center' }}>
                <span style={{ flex: 1 }}>
                  <b>{d.subjectName}</b>
                  <span className="mute"> · {d.chapterName}</span>
                </span>
                <span className="tag live">+{d.toTick}</span>
              </div>
            ))}
          </div>
        </>}

        {/* What to apply */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {preview.totalToTick > 0 && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={inclTicks} onChange={(e) => setInclTicks(e.target.checked)} style={{ accentColor: 'var(--amber)' }} />
              <span>Tick {preview.totalToTick} lecture{preview.totalToTick !== 1 ? 's' : ''}</span>
            </label>
          )}
          {preview.allTests.length > 0 && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={inclTests} onChange={(e) => setInclTests(e.target.checked)} style={{ accentColor: 'var(--amber)' }} />
              <span>Merge {preview.allTests.length} tests ({preview.newTestCount} new, {preview.updTestCount} updates)</span>
            </label>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn pri" onClick={apply}
            disabled={!(inclTicks && preview.totalToTick > 0) && !(inclTests && preview.allTests.length > 0)}>
            Apply
          </button>
          <button className="btn ghost" onClick={reset}>Cancel</button>
        </div>
        <div className="small mute" style={{ marginTop: 8 }}>PW can lag up to 24 h. Lectures you already ticked are never removed.</div>
      </>}

      {phase === 'done' && <>
        <div style={{ color: 'var(--ok)', marginBottom: 8 }}>✓ Applied. Sync will push changes to your other devices.</div>
        <button className="btn ghost" onClick={reset}>Import again</button>
      </>}
    </div>
  );
}

function DataCard({ s, setS }) {
  const today = dkey();
  return (
    <div className="card">
      <h3>Backup (everything: syllabus, tests, logs, mocks)</h3>
      <div className="row">
        <button className="btn ghost" onClick={() => download(`gate-command-center-${today}.json`, s)}>Export data</button>
        <button className="btn ghost" onClick={() => saveFile(`gate-summary-${today}.md`, readableSummary(s, readiness(s), today), 'text/markdown').catch(() => {})}>Export readable summary</button>
        <label className="btn ghost">Import data<input type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; f.text().then((t) => { try { const j = JSON.parse(t); if (!j || typeof j !== 'object' || Array.isArray(j) || !Array.isArray(j.subjects)) throw new Error('shape'); if (confirm('Replace ALL data on this device with this backup? If sync is on, your other devices will receive it too.')) setS((p) => ({ ...normalize(j), timer: p.timer })); } catch { alert('Not a valid backup file.'); } }); }} /></label>
      </div>
    </div>
  );
}

/* ───────── Syllabus: import, edit, categories ───────── */
function Syllabus({ s, set }) {
  const [f, setF] = useState('all'), [edit, setEdit] = useState(false), [msg, setMsg] = useState('');
  const upd = (sid, fn) => set('subjects', (a) => a.map((x) => (x.id === sid ? fn(x) : x)));
  const updCh = (sid, ci, fn) => upd(sid, (x) => ({ ...x, chapters: x.chapters.map((c, i) => (i === ci ? fn(c) : c)) }));
  const updLec = (sid, ci, li, patch) => updCh(sid, ci, (c) => ({ ...c, lectures: c.lectures.map((l, i) => (i === li ? { ...l, ...patch } : l)) }));
  const setCount = (sid, ci, n) => updCh(sid, ci, (c) => { const L = c.lectures.slice(0, Math.max(0, n)); while (L.length < n) L.push({ name: `Lecture ${L.length + 1}`, date: '' }); return { ...c, lectures: L }; });
  const list = s.subjects.filter((x) => f === 'all' || x.type === f);
  const onFile = async (e) => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      const inc = parseSyllabus(file.name, await file.text()), upd_ = countMatches(s.subjects, inc);
      set('subjects', (a) => mergeSubjects(a, inc));
      setMsg(`Imported ${inc.length} subjects from ${file.name}: ${upd_} updated, ${inc.length - upd_} new. Ticks kept where chapter and lecture names match.`);
    } catch (err) { setMsg(`Import failed: ${err.message}`); }
  };
  const addSub = () => set('subjects', (a) => [...a, { id: `custom-${Date.now()}`, name: 'New subject', type: 'live', row: null, chapters: [{ name: 'Chapter 1', lectures: [{ name: 'Lecture 1', date: '' }] }] }]);

  return (<>
    <div className="row" style={{ marginBottom: 10 }}>
      {[['all', 'All'], ['live', 'Live'], ['rec', 'Recorded']].map(([k, l]) => <button key={k} className={`btn ${f === k ? '' : 'ghost'}`} onClick={() => setF(k)}>{l}</button>)}
      <span style={{ flex: 1 }} />
      <button className={`btn ${edit ? '' : 'ghost'}`} onClick={() => setEdit(!edit)}>{edit ? 'Done editing' : 'Edit'}</button>
    </div>

    <div className="card">
      <div className="row">
        <label className="btn ghost">Import syllabus<input type="file" accept=".json,.csv,.html,.htm" hidden onChange={onFile} /></label>
        <button className="btn ghost" onClick={() => download('syllabus.json', s.subjects)}>Export syllabus</button>
      </div>
      <div className="small mute" style={{ marginTop: 8 }}>Accepts your checklist .html, a .json (use Export as the template) or a .csv with columns subject, type, chapter, lecture, date, dpp. Subjects that already exist are updated in place; new ones are added.</div>
      {msg && <div className="small" style={{ marginTop: 6, color: 'var(--amber)' }}>{msg}</div>}
    </div>

    <SubjectGantt s={s} set={set} />

    <div className="card" style={{ padding: '4px 14px' }}>
      {sortSubjects(list).map((sub, si, sarr) => {
        const all = sub.chapters.flatMap((c) => c.lectures), d = all.filter((l) => l.done).length;
        return (
          <React.Fragment key={sub.id}>
          <GroupHead prev={sarr[si - 1]} cur={sub} />
          <details className="sub">
            <summary>
              <span style={{ flex: 1, fontWeight: 600 }}>{sub.name}</span>
              {!sub.row && <span className="tag" style={{ color: 'var(--red)' }}>NOT COUNTED</span>}
              <span className={`tag ${sub.type !== 'rec' ? 'live' : ''}`}>{catLabel(sub.type)}</span>
              <span className="mute small" style={{ width: 54, textAlign: 'right' }}>{d}/{all.length}</span>
              <span style={{ width: 70 }}><Bar v={all.length ? d / all.length : 0} c={all.length && d === all.length ? 'g' : ''} /></span>
            </summary>
            <div className="row" style={{ margin: '2px 0 10px' }}>
              <label className="small mute">Category <select value={sub.type} onChange={(e) => upd(sub.id, (x) => ({ ...x, type: e.target.value }))}><option value="live">Live</option><option value="rec">Recorded</option></select></label>
              <label className="small mute">Counts toward <select value={sub.row || ''} onChange={(e) => upd(sub.id, (x) => ({ ...x, row: e.target.value || null }))}><option value="">Not counted</option>{ROWS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
            </div>
            {edit && <div className="row" style={{ marginBottom: 10 }}>
              <input type="text" style={{ flex: 1 }} value={sub.name} onChange={(e) => upd(sub.id, (x) => ({ ...x, name: e.target.value }))} />
              <button className="btn ghost" onClick={() => { if (confirm(`Delete ${sub.name} and its progress?`)) set('subjects', (a) => a.filter((x) => x.id !== sub.id)); }}>Delete subject</button>
            </div>}
            {sub.chapters.map((c, ci) => {
              const cd = c.lectures.filter((l) => l.done).length;
              return (
                <div className="chapter" key={ci}>
                  {edit ? (
                    <div className="row" style={{ marginBottom: 6 }}>
                      <input type="text" style={{ flex: 1, minWidth: 140 }} value={c.name} onChange={(e) => updCh(sub.id, ci, (x) => ({ ...x, name: e.target.value }))} />
                      <span className="row" style={{ gap: 4 }}>
                        <button className="btn ghost" style={{ padding: '2px 9px' }} onClick={() => setCount(sub.id, ci, c.lectures.length - 1)}>−</button>
                        <span className="small mute">{c.lectures.length} lectures</span>
                        <button className="btn ghost" style={{ padding: '2px 9px' }} onClick={() => setCount(sub.id, ci, c.lectures.length + 1)}>+</button>
                      </span>
                      <button className="btn ghost" style={{ padding: '2px 9px' }} onClick={() => { if (confirm(`Delete chapter "${c.name}"?`)) upd(sub.id, (x) => ({ ...x, chapters: x.chapters.filter((_, i) => i !== ci) })); }}>×</button>
                    </div>
                  ) : (
                    <div className="row sb"><span style={{ fontWeight: 600 }}>{c.name}</span>
                      <button className="btn ghost" style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => updCh(sub.id, ci, (x) => ({ ...x, lectures: x.lectures.map((l) => ({ ...l, done: cd !== x.lectures.length })) }))}>{c.lectures.length && cd === c.lectures.length ? 'Clear' : 'All done'}</button></div>
                  )}
                  {edit ? c.lectures.map((l, li) => (
                    <div className="row" key={li} style={{ marginBottom: 4 }}>
                      <input type="text" style={{ flex: 2, minWidth: 110 }} value={l.name} onChange={(e) => updLec(sub.id, ci, li, { name: e.target.value })} />
                      <input type="text" style={{ width: 78 }} placeholder="date" value={l.date || ''} onChange={(e) => updLec(sub.id, ci, li, { date: e.target.value })} />
                      <input type="text" style={{ width: 72 }} placeholder="DPP" value={l.dpp || ''} onChange={(e) => updLec(sub.id, ci, li, { dpp: e.target.value || undefined })} />
                    </div>
                  )) : (
                    <div className="lecs">
                      {c.lectures.map((l, li) => (
                        <span key={li} className={`lec ${l.done ? 'done' : ''}`} style={{ display: 'flex', gap: 8 }}>
                          <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={!!l.done} onChange={() => updLec(sub.id, ci, li, { done: !l.done })} />{l.name}</label>
                          {l.date && l.date !== '—' && l.date !== '-' ? <span className="dim small">{l.date}</span> : null}
                          {l.dpp ? <span className="tag dpp">{l.dpp}</span> : null}
                          <label className="tag" style={{ display: 'flex', gap: 3, alignItems: 'center', cursor: 'pointer', color: l.pyq ? 'var(--blue)' : 'var(--dim)' }}><input type="checkbox" checked={!!l.pyq} onChange={() => updLec(sub.id, ci, li, { pyq: !l.pyq })} /> PYQ</label>
                        </span>))}
                    </div>
                  )}
                </div>);
            })}
            {edit && <button className="btn ghost" style={{ margin: '4px 0 10px' }} onClick={() => upd(sub.id, (x) => ({ ...x, chapters: [...x.chapters, { name: 'New chapter', lectures: [{ name: 'Lecture 1', date: '' }] }] }))}>+ Add chapter</button>}
          </details>
          </React.Fragment>);
      })}
      {edit && <button className="btn ghost" style={{ margin: '10px 0' }} onClick={addSub}>+ Add subject</button>}
      {!list.length && <div className="mute small" style={{ padding: '10px 0' }}>No subjects in this category.</div>}
    </div>
  </>);
}

/* ───────── Readiness: weighted by marks map ───────── */
function Ready({ s, set }) {
  const R = useMemo(() => readiness(s), [s.subjects, s.mocks, s.marks, s.weights, s.log, s.sched]);
  const gap = [...R.rows].map((r) => ({ ...r, left: r.marks * (1 - r.score) * (100 / R.total) })).sort((a, b) => (b.urgent - a.urgent) || (b.left - a.left));
  const unmapped = s.subjects.filter((x) => !ROWS.some((r) => r.id === x.row));
  const stat = (label, v, sub) => (<div><div className="row sb small mute"><span>{label}</span><span>{Math.round(v * 100)}%</span></div><Bar v={v} /><div className="dim small">{sub}</div></div>);
  return (<>
    <div className="card">
      <div className="row sb">
        <div><div className="num" style={{ fontSize: 46, color: 'var(--amber)' }}>{(R.pct * 100).toFixed(1)}%</div><div className="mute small">weighted exam readiness</div></div>
        <div style={{ textAlign: 'right' }}><div className="num">{R.marks.toFixed(0)}<span className="mute small"> marks</span></div>
          <div className="mute small">target <Inline min={30} max={100} value={s.target} onValue={(v) => set('target', v)} /></div></div>
      </div>
      <div style={{ marginTop: 10 }}><Bar v={R.marks / s.target} c={R.marks >= s.target ? 'g' : ''} /></div>
      <div className="small mute" style={{ marginTop: 8 }}>Coverage comes from lectures ticked done, PYQ from lectures ticked PYQ-attempted, and mock accuracy from subject-wise mock scores you log in Tests — nothing here is typed in by hand. Each is weighted then scaled by exam marks.</div>
    </div>

    {unmapped.length > 0 && <div className="card"><h3 style={{ color: 'var(--red)' }}>Not counted toward readiness</h3><div className="small mute">{unmapped.map((x) => x.name).join(', ')}. Open the subject in Syllabus and pick "Counts toward".</div></div>}

    <div className="card">
      <h3>Biggest marks still on the table</h3>
      {gap.slice(0, 4).map((r) => <div key={r.id} className="row sb small" style={{ padding: '3px 0' }}><span>{r.name} <span className="tag" style={{ color: TIER_COLOR[r.tier] }}>{r.tier}</span></span><span className="mute">{r.left.toFixed(1)} marks</span></div>)}
    </div>

    {sortReadyRows(R.rows).map((r, ri, rarr) => (
      <React.Fragment key={r.id}>
      <GroupHead prev={rarr[ri - 1]} cur={r} ready />
      <details className="card" style={{ padding: '10px 14px' }}>
        <summary style={{ listStyle: 'none', cursor: 'pointer' }}>
          <div className="row sb" style={{ flexWrap: 'nowrap' }}><b style={{ minWidth: 0 }}>{r.name} <span className="tag" style={{ color: TIER_COLOR[r.tier] }}>{r.tier}</span></b><span className="small" style={{ whiteSpace: 'nowrap', color: r.urgent ? 'var(--red)' : r.label === 'Strong' ? 'var(--green)' : r.label === 'Weak' ? 'var(--red)' : 'var(--amber)' }}>{r.urgent ? 'URGENT · ' : ''}{r.label} · {(r.score * 100).toFixed(0)}%</span></div>
          <div style={{ marginTop: 6 }}><Bar v={r.score} c={r.score >= 0.7 ? 'g' : ''} /></div>
        </summary>
        <div className="small mute" style={{ margin: '8px 0 2px' }}>{r.d}/{r.t} lectures · {r.label === 'Strong' ? 'maintenance: only touch in full mocks' : r.label === 'Medium' ? 'focus on weak chapters and PYQ gaps' : 'needs foundation revision and topic tests'}</div>
        <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '6px 0' }}><input type="checkbox" checked={r.urgent} onChange={(e) => set('urgent', (u) => ({ ...(u || {}), [r.id]: e.target.checked }))} /> Mark urgent (the planner puts it first)</label>
        <div className="row sb small mute" style={{ margin: '8px 0' }}><span>Exam marks for this subject</span><Inline min={0} max={30} value={r.marks} onValue={(v) => set('marks', (m) => ({ ...m, [r.id]: v }))} /></div>
        <div className="grid" style={{ gap: 14 }}>
          {stat('PYQ attempted', r.pyq, `${r.pq}/${r.t} lectures`)}
          {r.rev == null ? <div><div className="row sb small mute"><span>Test score</span><span>no data</span></div><div className="dim small">no subject test yet, so its weight is dropped and nothing is penalised</div></div> : stat('Test score', r.rev, `${r.mockN} subject test${r.mockN > 1 ? 's' : ''}, pulled toward ${s.tPrior ?? 50}% until history builds`)}
        </div>
      </details>
      </React.Fragment>))}

  </>);
}

/* ───────── Mocks: log, diagnostics, editable test series ───────── */
function Mocks({ s, set }) {
  const blank = { test: 'custom', name: '', date: dkey(), score: '', max: 100, concept: '', calc: '', time: '', silly: '', subj: {} };
  const [f, setF] = useState(blank), [msg, setMsg] = useState('');
  const tests = s.tests;
  const pick = (id) => { const t = tests.find((x) => x.id === id); setF({ ...f, test: id, name: t ? t.name : '', max: t ? t.marks : 100, date: t?.date || f.date }); };
  const add = () => {
    const score = parseFloat(f.score), max = parseFloat(f.max) || 100;
    if (isNaN(score) || score > max) return alert('Enter a score between 0 and the maximum marks.');
    const m = { id: Date.now(), test: f.test, name: f.name || 'Mock', date: f.date, score, max };
    CATS.forEach(([k]) => (m[k] = parseFloat(f[k]) || 0));
    m.subj = Object.fromEntries(Object.entries(f.subj || {}).filter(([, v]) => v !== '' && !isNaN(+v)).map(([k, v]) => [k, +v]));
    set('mocks', (a) => [...a, m].sort((x, y) => x.date.localeCompare(y.date)));
    setF(blank);
  };
  const updTest = (id, patch) => set('tests', (a) => a.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const onTests = async (e) => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      const inc = parseTests(file.name, await file.text()), u = countTestMatches(tests, inc);
      set('tests', (a) => mergeTests(a, inc));
      setMsg(`Imported ${inc.length} tests from ${file.name}: ${u} updated, ${inc.length - u} new.`);
    } catch (err) { setMsg(`Import failed: ${err.message}`); }
  };

  const M = s.mocks, full = M.filter((m) => m.max >= 100), basis = full.length ? full : M;
  const last3 = basis.slice(-3), avg = last3.length ? last3.reduce((a, m) => a + norm(m), 0) / last3.length : null;
  const level = avg == null ? null : CUTOFFS.find((c) => avg >= c.min);
  const lost = {}; let unc = 0, totalLost = 0;
  M.forEach((m) => { const k = 100 / m.max; CATS.forEach(([c]) => (lost[c] = (lost[c] || 0) + m[c] * k)); const L = (m.max - m.score) * k; totalLost += L; unc += Math.max(0, L - CATS.reduce((a, [c]) => a + m[c] * k, 0)); });
  const worst = CATS.map(([c, l]) => [c, l, lost[c] || 0]).sort((a, b) => b[2] - a[2])[0];
  const advice = { concept: 'Go back to the module and PYQs for the leaking subject; more mocks will not fix a gap in the concept.', calc: 'Practise with the on-screen virtual calculator and write intermediate steps in the rough sheet.', time: 'Train the two-pass strategy: aptitude first (cap 20 min), skip anything over 3 min, return later.', silly: 'Re-read units and constraints before answering; tag each one with its exact reason in the error log.' };
  const logged = new Set(M.map((m) => m.test)), today = dkey();
  const pending = tests.filter((t) => !logged.has(t.id));
  const upcoming = pending.filter((t) => t.date && t.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  const twoPass = (x) => (['mock', 'gbg', 'pyq', 'mst'].includes(x.kind) && x.mins ? `Pass 1 to ${Math.round(x.mins * 0.67)}m · Pass 2 to ${Math.round(x.mins * 0.92)}m · review to ${x.mins}m` : '');
  const missed = pending.filter((t) => t.date && t.date < today).length;

  return (<>
    {(upcoming.length > 0 || missed > 0) && <div className="card">
      <div className="row sb"><h3 style={{ margin: 0 }}>Next tests</h3>{missed > 0 && <span className="small" style={{ color: 'var(--amber)' }}>{missed} missed / not logged</span>}</div>
      {upcoming.map((x) => <div key={x.id} style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}><div className="row sb small"><span>{x.name}</span><span className="mute">{shortDate(x.date)}{x.time ? ' ' + x.time : ''} · {x.marks}m{x.mins ? ` · ${x.mins} min` : ''}</span></div>{twoPass(x) && <div className="dim small">{twoPass(x)}</div>}</div>)}
    </div>}

    <div className="card">
      <h2>Log a test</h2>
      <div className="grid" style={{ gap: 8 }}>
        <select value={f.test} onChange={(e) => pick(e.target.value)}><option value="custom">Custom test</option>{tests.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <input type="text" placeholder="Test name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
      </div>
      <div className="row" style={{ margin: '10px 0' }}>
        <span className="small mute">Score</span><input type="number" value={f.score} onChange={(e) => setF({ ...f, score: e.target.value })} />
        <span className="small mute">out of</span><input type="number" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} />
      </div>
      <div className="small mute" style={{ marginBottom: 4 }}>Marks lost by reason</div>
      <div className="row" style={{ marginBottom: 10 }}>{CATS.map(([k, l]) => <label key={k} className="small mute">{l}<br /><input type="number" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}</div>
      <SubjectInputs f={f} setF={setF} />
      <button className="btn" onClick={add}>Save test</button>
    </div>

    {M.length > 0 && <>
      <div className="grid">
        <div className="card"><div className="mute small">Average of last {last3.length} {full.length ? 'full mocks' : 'tests'} (/100)</div><div className="num" style={{ color: level.color }}>{avg.toFixed(1)}</div><div className="small">{level.label} <span className="mute">· {level.sub}</span></div></div>
        <div className="card"><div className="mute small">Gap to {s.target} target</div><div className="num">{avg >= s.target ? 'On track' : `+${(s.target - avg).toFixed(1)}`}</div><div className="small mute">{M.length} tests logged</div></div>
      </div>

      <div className="card">
        <h3>Where the marks leak</h3>
        {CATS.map(([c, l]) => <div key={c} style={{ marginBottom: 8 }}><div className="row sb small"><span>{l}</span><span className="mute">{(lost[c] || 0).toFixed(1)} marks · {totalLost ? Math.round(((lost[c] || 0) / totalLost) * 100) : 0}%</span></div><Bar v={totalLost ? (lost[c] || 0) / totalLost : 0} c={c === 'silly' ? 'r' : c === 'time' ? 'b' : ''} /></div>)}
        {unc > 0.5 && <div className="small dim">{unc.toFixed(1)} lost marks not yet classified. Tag them; "silly mistake" is only a reason if you say what you misread.</div>}
        {worst[2] > 0 && <div className="small" style={{ marginTop: 8 }}><b>Biggest leak: {worst[1]}.</b> <span className="mute">{advice[worst[0]]}</span></div>}
      </div>

      <MockTrend s={s} />

      <SubjectAnalysis s={s} />

      <div className="card">
        <h3>Cutoff map (normalised to /100)</h3>
        {CUTOFFS.map((c) => <div key={c.label} className="row sb small" style={{ padding: '4px 0', opacity: avg >= c.min ? 1 : 0.55 }}>
          <span style={{ color: c.color, fontWeight: 600 }}>{level.label === c.label ? '▸ ' : ''}{c.label} <span className="mute" style={{ fontWeight: 400 }}>{c.sub}</span></span><span className="mute">{c.min}+</span></div>)}
        <div className="small dim" style={{ marginTop: 6 }}>Indicative bands from your tracker; real cutoffs move every year and by category.</div>
      </div>

      <div className="card">
        <h3>Trajectory checkpoints (from your 120-day tracker)</h3>
        {CHECKPOINTS.map((c) => { const due = c.by <= today, ok = c.min == null ? null : avg >= c.min;
          return <div key={c.by} className="row sb small" style={{ padding: '4px 0' }}><span>{c.label}</span><span className="pill" style={{ color: ok == null ? 'var(--mute)' : ok ? 'var(--green)' : due ? 'var(--red)' : 'var(--amber)' }}>{shortDate(c.by)}{ok == null ? '' : ok ? ' · met' : due ? ' · missed' : ' · pending'}</span></div>; })}
      </div>

      <div className="card">
        <h3>History</h3>
        <table><thead><tr><th>Test</th><th>Score</th><th>/100</th><th /></tr></thead><tbody>
          {[...M].reverse().map((m) => <tr key={m.id}><td>{m.name}<div className="dim small">{m.date}</div></td><td>{m.score}/{m.max}</td><td>{norm(m).toFixed(0)}</td><td><button className="btn ghost" style={{ padding: '1px 8px' }} onClick={() => set('mocks', (a) => a.filter((x) => x.id !== m.id))}>×</button></td></tr>)}
        </tbody></table>
      </div>
    </>}

    <div className="card">
      <h3>Test series ({tests.length} tests · {logged.size} logged)</h3>
      <div className="row" style={{ marginBottom: 8 }}>
        <label className="btn ghost">Import test series<input type="file" accept=".json,.csv" hidden onChange={onTests} /></label>
        <button className="btn ghost" onClick={() => download('test-series.json', tests)}>Export</button>
      </div>
      <div className="small mute">Accepts .json (use Export as the template) or .csv with columns name, date, marks. Dates as YYYY-MM-DD or DD/MM/YYYY. Matching names update in place; new tests are added; your logged scores are kept.</div>
      {msg && <div className="small" style={{ marginTop: 6, color: 'var(--amber)' }}>{msg}</div>}
      <details className="sub" style={{ marginTop: 10 }}>
        <summary style={{ fontWeight: 600 }}>Edit test list</summary>
        {tests.map((t) => (
          <div className="row" key={t.id} style={{ marginBottom: 6 }}>
            <input type="text" style={{ flex: 2, minWidth: 130 }} value={t.name} onChange={(e) => updTest(t.id, { name: e.target.value })} />
            <input type="date" value={t.date || ''} onChange={(e) => updTest(t.id, { date: e.target.value })} />
            <input type="number" style={{ width: 62 }} value={t.marks} onChange={(e) => updTest(t.id, { marks: +e.target.value || 0 })} />
            <button className="btn ghost" style={{ padding: '2px 9px' }} onClick={() => { if (confirm(`Remove "${t.name}" from the series? Logged scores stay.`)) set('tests', (a) => a.filter((x) => x.id !== t.id)); }}>×</button>
          </div>))}
        <button className="btn ghost" onClick={() => set('tests', (a) => [...a, { id: `t${Date.now()}`, name: 'New test', date: dkey(), marks: 100 }])}>+ Add test</button>
      </details>
    </div>
  </>);
}

createRoot(document.getElementById('root')).render(<App />);

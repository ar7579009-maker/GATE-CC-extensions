// Pure planning engine (no DOM, no React, no network): unit-tested in planner.test.mjs.
// Dates are 'YYYY-MM-DD'. buildPlan() turns the saved app state into: a verdict against the target date,
// a Do-now pick, and Today / Week / Month / Exam lists.

const DAY = 864e5;
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const p2 = (n) => String(n).padStart(2, '0');
const at = (k) => new Date(k + 'T12:00:00');
const fmt = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const addDays = (k, n) => { const d = at(k); d.setDate(d.getDate() + n); return fmt(d); };
export const diffDays = (a, b) => Math.round((at(a) - at(b)) / DAY);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hh = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : 0);

// 'D Mon' (as written in the PW planner, no year) -> ISO date nearest to today. Placeholders like '-' give null.
export function lectureDate(str, today) {
  const m = /^(\d{1,2}) ([A-Za-z]{3})/.exec(String(str || '').trim());
  if (!m || MON[m[2]] == null) return null;
  const y = at(today).getFullYear();
  let d = new Date(y, MON[m[2]], +m[1], 12);
  if (diffDays(fmt(d), today) < -183) d = new Date(y + 1, MON[m[2]], +m[1], 12);
  else if (diffDays(fmt(d), today) > 182) d = new Date(y - 1, MON[m[2]], +m[1], 12);
  return fmt(d);
}

// Days from..to inclusive, minus the weekly rest day (0 = Sunday ... 6 = Saturday, -1 = none).
export function workDays(from, to, restDay = -1) {
  let n = 0;
  for (let d = from, i = 0; d <= to && i < 4000; d = addDays(d, 1), i++) if (at(d).getDay() !== restDay) n++;
  return n;
}

export const PLAN_DEF = { hPerLecture: 1.8, plc: 4, revPct: 25, bufferPct: 15, restDay: -1, capH: 9, skip: {} };
export const planCfg = (p) => ({ ...PLAN_DEF, ...(p || {}), skip: { ...((p && p.skip) || {}) } });

const isPlaceholder = (l) => l.name === 'Lectures done';
const FULL = new Set(['mock', 'mst', 'gbg', 'pyq']);
const weekStartOf = (k) => addDays(k, -((at(k).getDay() + 6) % 7));
const monthStartOf = (k) => k.slice(0, 8) + '01';
const monthEndOf = (k) => { const d = at(k); return fmt(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12)); };
const inRange = (d, a, b) => d >= a && d <= b;
const testSpan = (t) => [t.date, t.end || t.date];

/* inp: { today, targetDate, examDate, goalH, subjects, tests, mocks, revDue, log, rows:[{id,name,marks,group}],
          sched:{rowId:[a,b]}, mastery:{rowId:0..1}, urgent:{rowId:bool}, plan, neglectDays, goalMin:{ga,ma,core}, pyq:{count,goal} } */
export function buildPlan(inp) {
  const cfg = planCfg(inp.plan), today = inp.today, log = inp.log || {};
  const rows = inp.rows || [], rowById = new Map(rows.map((r) => [r.id, r]));
  const totalMarks = rows.reduce((a, r) => a + r.marks, 0) || 1;
  const subjects = inp.subjects || [], tests = inp.tests || [], mocks = inp.mocks || [];
  const units = (l) => (isPlaceholder(l) ? cfg.plc : 1);
  const keyOf = (sub) => sub.row || '_' + sub.id;

  // ── measured pace: logged hours per finished lecture, per marks row (falls back to the default) ──
  const hoursLogged = {};
  Object.values(log).forEach((day) => Object.entries(day || {}).forEach(([id, sec]) => { hoursLogged[id] = (hoursLogged[id] || 0) + sec / 3600; }));
  const doneU = {};
  subjects.forEach((sub) => sub.chapters.forEach((c) => c.lectures.forEach((l) => { if (l.done) doneU[keyOf(sub)] = (doneU[keyOf(sub)] || 0) + units(l); })));
  const paceOf = (key) => {
    const du = doneU[key] || 0, h = hoursLogged[key] || 0;
    return du >= 5 && h > 0 ? { h: clamp(h / du, 0.5, 5), measured: true } : { h: cfg.hPerLecture, measured: false };
  };

  // ── per subject remaining work ──
  const subs = subjects.map((sub) => {
    let left = 0, total = 0, done = 0;
    sub.chapters.forEach((c) => c.lectures.forEach((l) => { total++; if (l.done) done++; else left += units(l); }));
    const pace = paceOf(keyOf(sub)), row = sub.row ? rowById.get(sub.row) : null;
    let videoSec = 0; sub.chapters.forEach((c) => c.lectures.forEach((l) => { if (!l.done && l.dur > 0) videoSec += l.dur; }));
    return { sub, row, left, total, done, pace, videoSec, skipped: false, hours: left * pace.h * (1 + cfg.revPct / 100) };
  });
  const active = subs.filter((x) => !x.skipped);
  const remainingH = active.reduce((a, x) => a + x.hours, 0);
  const remainingU = active.reduce((a, x) => a + x.left, 0);

  // ── row status (same rule the Schedule view uses) ──
  const rowStatus = (r) => {
    const [a, b] = (inp.sched && inp.sched[r.id]) || ['2026-09-01', '2026-12-31'];
    let d = 0, t = 0;
    subs.filter((x) => x.sub.row === r.id && !x.skipped).forEach((x) => { d += x.done; t += x.total; });
    const act = t ? d / t : 0, exp = clamp(diffDays(today, a) / Math.max(1, diffDays(b, a)), 0, 1), gap = act - exp;
    const status = !t ? 'none' : today < a ? 'upcoming' : act >= 1 ? 'done' : today > b ? 'overdue' : gap >= -0.05 ? 'on pace' : 'behind';
    return { a, b, act, exp, gap, status, t, d };
  };
  const rs = new Map(rows.map((r) => [r.id, rowStatus(r)]));
  const rowLeft = (id) => active.filter((x) => x.sub.row === id).reduce((a, x) => a + x.left, 0);
  const prio = (r) => {
    const st = rs.get(r.id), lag = Math.max(0, -st.gap), m = inp.mastery && inp.mastery[r.id] != null ? inp.mastery[r.id] : 0.3;
    return r.marks * (1 + 2 * lag) * (1.5 - clamp(m, 0, 1)) * (inp.urgent && inp.urgent[r.id] ? 1.5 : 1) * (st.status === 'upcoming' ? 0.4 : 1);
  };

  // ── target-date verdict ──
  const wd = Math.max(0, workDays(today, inp.targetDate, cfg.restDay));
  const eff = wd * (1 - cfg.bufferPct / 100);
  const need = remainingH <= 0 ? 0 : eff > 0 ? remainingH / eff : Infinity;
  let a7 = 0; for (let i = 1; i <= 7; i++) a7 += Object.values(log[addDays(today, -i)] || {}).reduce((a, b) => a + b, 0) / 3600;
  const actual7 = a7 / 7, goalH = inp.goalH;
  const status = remainingH <= 0 ? 'green' : actual7 > 0 && need <= actual7 ? 'green' : need <= goalH ? 'amber' : 'red';
  const missedAll = [];
  active.forEach((x) => { if (x.sub.type === 'live') x.sub.chapters.forEach((c) => c.lectures.forEach((l) => { const d = lectureDate(l.date, today); if (d && d < today && !l.done) missedAll.push({ x, c, l, d }); })); });
  missedAll.sort((p, q) => p.d.localeCompare(q.d));

  const options = [];
  if (status !== 'green') {
    if (Number.isFinite(need)) options.push({ id: 'raise', kind: 'raise', label: `Study ${hh(need)} h a day${actual7 > 0 ? ` (last 7 days: ${hh(actual7)})` : ''}` });
  }
  const horizon = {
    targetDate: inp.targetDate, daysLeft: Math.max(0, diffDays(inp.targetDate, today)), workDays: wd, bufferPct: cfg.bufferPct, restDay: cfg.restDay, remainingLectures: remainingU,
    remainingHours: hh(remainingH), videoHours: hh(active.reduce((a, x) => a + x.videoSec, 0) / 3600), needPerDay: Number.isFinite(need) ? hh(need) : null, actual7: hh(actual7), goalH, gap: Number.isFinite(need) ? hh(need - actual7) : null,
    status, missedLive: missedAll.length, options, pace: [...new Set(active.filter((x) => x.left > 0).map((x) => keyOf(x.sub)))].filter((k) => paceOf(k).measured).length,
  };

  // ── fixed + carry-over + revisions + template + PYQ for today ──
  const attempted = new Set(mocks.map((m) => m.test));
  const est = [];  // ordered Today items
  const push = (it) => est.push({ done: false, est: 0, ...it });
  tests.filter((t) => { const [a, b] = testSpan(t); return inRange(today, a, b) && !attempted.has(t.id); })
    .sort((p, q) => String(p.time || '').localeCompare(String(q.time || '')))
    .forEach((t) => push({ key: 'test:' + t.id, kind: 'test', label: t.name, detail: `${t.time ? t.time + ' · ' : ''}${t.mins} min${t.end && t.end !== t.date ? ` · window to ${t.end}` : ''}`, est: t.mins / 60 + 0.5 }));
  const liveRows = new Set();
  active.forEach((x) => { if (x.sub.type !== 'live') return; x.sub.chapters.forEach((c) => c.lectures.forEach((l) => {
    if (l.done || lectureDate(l.date, today) !== today) return;
    liveRows.add(keyOf(x.sub)); push({ key: `live:${x.sub.id}:${c.name}:${l.name}`, kind: 'live', label: `${x.sub.name}: ${l.name}`, detail: `${c.name} · live today`, est: x.pace.h });
  })); });
  const rv = inp.revDue || [];
  rv.slice(0, 3).forEach((r) => push({ key: `rev:${r.sub}:${r.ch}:${r.i}`, kind: 'revision', rk: r.key, ri: r.i, label: `Revise ${r.ch}`, detail: `${r.sub} · R${r.i + 1}${r.late > 0 ? ` · ${r.late}d late` : ''}`, est: 0.4 }));
  if (rv.length > 3) push({ key: 'rev:more', kind: 'revision', label: `${rv.length - 3} more revisions due`, detail: 'They appear here as you finish these', est: 0.4 * (rv.length - 3) });
  missedAll.filter((m) => diffDays(today, m.d) <= 14).slice(0, 3).forEach((m) => push({ key: `miss:${m.x.sub.id}:${m.c.name}:${m.l.name}`, kind: 'catchup', label: `Catch up: ${m.x.sub.name} ${m.l.name}`, detail: `${m.c.name} · was live ${m.d}`, est: m.x.pace.h }));

  const minToday = (g) => rows.filter((r) => r.group === g).reduce((a, r) => a + ((log[today] || {})[r.id] || 0), 0) / 60;
  const nextUnit = (rid) => {
    for (const x of active) {
      if (x.sub.row !== rid || x.sub.type === 'live') continue;
      for (const c of x.sub.chapters) for (const l of c.lectures) if (!l.done) return isPlaceholder(l) ? `${c.name}` : `${c.name} · ${l.name}`;
    }
    return null;
  };
  const pick = (g, n) => rows.filter((r) => r.group === g && !liveRows.has(r.id) && !['done', 'none'].includes(rs.get(r.id).status))
    .sort((p, q) => prio(q) - prio(p)).slice(0, n);
  const tmpl = (g, title, n) => {
    const goal = (inp.goalMin && inp.goalMin[g]) || 60, m = Math.round(minToday(g)), done = m >= goal, left = Math.max(0, goal - m);
    const ps = pick(g, n);
    if (!ps.length && g !== 'core') { const r = rows.find((q) => q.group === g); if (r) ps.push(r); }
    ps.forEach((r, i) => push({ key: `tmpl:${g}:${r.id}`, kind: g, label: `${r.name}: ${nextUnit(r.id) || 'DPP and PYQs from recent lectures'}`, detail: i === 0 ? `${title} · ${m} / ${goal} min today` : title, done, est: i === 0 ? left / 60 : 0 }));
  };
  tmpl('ga', 'Aptitude block', 1); tmpl('ma', 'Maths block', 1); tmpl('core', 'Core block', Math.max(0, 2 - liveRows.size));
  const pq = inp.pyq || { count: 0, goal: 10 };
  push({ key: 'pyq', kind: 'pyq', label: `Solve ${pq.goal} PYQs`, detail: `${pq.count} / ${pq.goal} today`, done: pq.count >= pq.goal, est: pq.count >= pq.goal ? 0 : 0.5 });

  let acc = 0; const items = [], over = [];
  est.forEach((it) => { if (it.done) { items.push(it); return; } if (acc + it.est > cfg.capH && items.some((q) => !q.done)) over.push(it); else { acc += it.est; items.push(it); } });
  const doNow = items.find((it) => !it.done) || null;

  // ── week ──
  const w0 = weekStartOf(today), w1 = addDays(w0, 6), week = [];
  active.forEach((x) => { if (x.sub.type !== 'live') return; let t = 0, d = 0, past = 0;
    x.sub.chapters.forEach((c) => c.lectures.forEach((l) => { const ld = lectureDate(l.date, today); if (ld && inRange(ld, w0, w1)) { t++; if (l.done) d++; else if (ld < today) past++; } }));
    if (t) week.push({ key: 'wl:' + x.sub.id, kind: 'live', label: `${x.sub.name}: ${d} / ${t} live lectures`, detail: past ? `${past} already missed` : 'this week', done: d === t, tone: past ? 'red' : '' });
  });
  const weekTests = tests.filter((t) => { const [a, b] = testSpan(t); return !t.anytime && a <= w1 && b >= w0; }).sort((p, q) => p.date.localeCompare(q.date));
  weekTests.slice(0, 8).forEach((t) => week.push({ key: 'wt:' + t.id, kind: 'test', label: t.name, detail: t.date + (t.end && t.end !== t.date ? ` to ${t.end}` : ''), done: attempted.has(t.id) }));
  const recentMock = mocks.some((m) => m.date && diffDays(today, m.date) <= 10 && diffDays(today, m.date) >= 0);
  if (!weekTests.some((t) => FULL.has(t.kind)) && !recentMock) week.push({ key: 'wmock', kind: 'test', label: 'Take one full-length test this week', detail: 'No full test scheduled and none logged in 10 days', done: false, tone: 'amber' });
  rows.filter((r) => { const st = rs.get(r.id); return rowLeft(r.id) > 0 && st.status !== 'upcoming' && st.status !== 'done'; }).forEach((r) => {
    let last = ''; Object.keys(log).forEach((d) => { if (((log[d] || {})[r.id] || 0) > 0 && d > last) last = d; });
    const st = rs.get(r.id), days = last && last >= st.a ? diffDays(today, last) : diffDays(today, st.a);
    if (days >= (inp.neglectDays || 5)) week.push({ key: 'wn:' + r.id, kind: 'neglect', label: `${r.name}: untouched ${last && last >= st.a ? days + ' days' : 'since it started'}`, detail: 'Give it a block this week', done: false, tone: 'amber' });
  });
  [...rs.entries()].filter(([, st]) => st.status === 'behind' || st.status === 'overdue').sort((p, q) => p[1].gap - q[1].gap).slice(0, 3)
    .forEach(([id, st]) => week.push({ key: 'wb:' + id, kind: 'behind', label: `${rowById.get(id).name}: ${Math.round(st.act * 100)}% done vs ${Math.round(st.exp * 100)}% planned`, detail: st.status === 'overdue' ? 'past its end date' : 'behind schedule', done: false, tone: 'red' }));
  const recU = active.filter((x) => x.sub.type === 'rec').reduce((a, x) => a + x.left, 0), recH = active.filter((x) => x.sub.type === 'rec').reduce((a, x) => a + x.hours, 0);
  if (recU > 0) week.push({ key: 'wrec', kind: 'recorded', label: `Recorded backlog: ${recU} lectures`, detail: `about ${hh(recH)} h with DPP, PYQs and revision`, done: false });
  const sumH = (a, b) => { let s = 0; for (let d = a; d <= b && d <= today; d = addDays(d, 1)) s += Object.values(log[d] || {}).reduce((x, y) => x + y, 0) / 3600; return s; };
  const perDay = Number.isFinite(need) && need > 0 ? need : goalH;
  const weekHours = { done: hh(sumH(w0, w1)), target: hh(perDay * workDays(w0, w1, cfg.restDay)) };

  // ── month ──
  const m0 = monthStartOf(today), m1 = monthEndOf(today), month = [];
  rows.forEach((r) => { const st = rs.get(r.id); if (st.status === 'done' || st.status === 'upcoming' && st.a > m1 || !inRange(st.b, m0, m1) || rowLeft(r.id) <= 0) return;
    month.push({ key: 'mo:' + r.id, kind: 'subject', label: `${r.name}: finish by ${st.b}`, detail: `${Math.round(st.act * 100)}% done · ${rowLeft(r.id)} lectures left`, done: false, tone: st.status === 'behind' || st.status === 'overdue' ? 'red' : '' });
  });
  const mt = tests.filter((t) => !t.anytime && inRange(t.date, m0, m1)), mtd = mt.filter((t) => attempted.has(t.id));
  if (mt.length) month.push({ key: 'mtests', kind: 'test', label: `Tests: ${mtd.length} of ${mt.length} attempted`, detail: `${mt.filter((t) => FULL.has(t.kind)).length} full-length this month`, done: mtd.length === mt.length });
  const monthHours = { done: hh(sumH(m0, m1)), target: hh(perDay * workDays(m0, m1, cfg.restDay)) };

  // ── until the exam ──
  const fullTests = tests.filter((t) => FULL.has(t.kind) && !t.anytime && t.date <= inp.examDate);
  const exam = {
    examDate: inp.examDate, daysLeft: Math.max(0, diffDays(inp.examDate, today)), revisionDays: Math.max(0, diffDays(inp.examDate, inp.targetDate)),
    testsDone: fullTests.filter((t) => attempted.has(t.id)).length, testsTotal: fullTests.length,
    next: fullTests.filter((t) => t.date >= today && !attempted.has(t.id)).sort((p, q) => p.date.localeCompare(q.date)).slice(0, 3).map((t) => ({ name: t.name, date: t.date })),
  };

  return { today: { items, over, hours: hh(acc), capH: cfg.capH }, doNow, week: { from: w0, to: w1, items: week, hours: weekHours }, month: { from: m0, to: m1, items: month, hours: monthHours }, horizon, exam };
}


/* ── per-subject mastery (feeds the Do-now pick): M = Wc*C + Wp*P + Wt*T, all 0-100 ──
   T = test average shrunk toward a neutral prior; with no subject-wise test yet the test weight is dropped and the rest rescale. */
export const MASTERY_K = 2;
export const DEFAULT_PRIOR = 50;
export const shrink = (n, avg, prior = DEFAULT_PRIOR, k = MASTERY_K) => (n ? (n * avg + k * prior) / (n + k) : null);
export function weightsFor(w, hasTest) {
  const wc = +w.cov || 0, wp = +w.pyq || 0, wt = hasTest ? +w.rev || 0 : 0, sum = wc + wp + wt || 1;
  return { cov: wc / sum, pyq: wp / sum, test: wt / sum };
}
export const masteryLabel = (M) => (M >= 85 ? 'Strong' : M >= 50 ? 'Medium' : 'Weak');
export function mastery({ C, P, tests = [], w, prior = DEFAULT_PRIOR }) {
  const n = tests.length, avg = n ? tests.reduce((a, b) => a + b, 0) / n : 0, T = shrink(n, avg, prior);
  const W = weightsFor(w, n > 0);
  const raw = W.cov * C + W.pyq * P + W.test * (T ?? 0);
  return { M: raw, raw, C, P, T, n, W, label: masteryLabel(raw) };
}


/* ── pace calculator ──
   total   = hours left at 1x from buildPlan (lecture video + DPP + notes + revision)
   video   = the part of that which is lecture video with a known length; only this part speeds up with playback speed.
   hours(v) = total - video + video / v */
export function calcPace({ total, video = 0, speed = 1, hPerDay, windowDays, today, targetDate, restDay = -1, bufferPct = 15 }) {
  const v = Math.max(0.5, +speed || 1), vid = Math.min(Math.max(0, video), Math.max(0, total));
  const hours = total - vid + vid / v, eff = Math.max(0, hPerDay) * (1 - bufferPct / 100);
  const wd = Math.max(0, workDays(today, targetDate, restDay));
  let finish = null;
  if (hours <= 0) finish = today;
  else if (eff > 0) { let d = today, i = 0; while (i++ < 4000 && workDays(today, d, restDay) * eff < hours) d = addDays(d, 1); if (i < 4000) finish = d; }
  const win = Math.max(0, Math.round(windowDays || 0));
  return {
    hours: hh(hours), finish, daysEarly: finish ? diffDays(targetDate, finish) : null,
    windowHours: hh(win > 0 ? workDays(today, addDays(today, win - 1), restDay) * eff : 0),
    neededPerDay: hours <= 0 ? 0 : wd > 0 ? hh(hours / (wd * (1 - bufferPct / 100))) : null,
  };
}

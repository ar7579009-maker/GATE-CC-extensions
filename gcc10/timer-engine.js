// timer-engine.js: drop-in hardening for timer.jsx. Pure functions (no React/DOM) so node can test them.
// Same timer shape as v7: { sub, ts, mode, target, carry, acc, runAt|null, note, alerted, keep } + new `hb` (last heartbeat, ms).
export const HB_MS = 15000;            // heartbeat period while the app is in the foreground
export const GAP_MS = 120000;          // cold boot with a longer silence than this => ask the user
export const MAX_H = 12;               // a single run longer than this is always questioned

export const N = (t) => t && { mode: 'free', carry: 0, acc: 0, runAt: t.ts, ...t };
// Elapsed = acc + (now - runAt). Wall-clock based, so a frozen JS thread cannot cause drift.
// Math.max(now, hb): if the system clock is moved backwards the timer holds still instead of going negative.
export const tSeg = (t, now) => { t = N(t); const n = Math.max(now, t.hb || 0); return t.acc + (t.runAt ? Math.max(0, n - t.runAt) / 1000 : 0); };
export const tTotal = (t, now) => N(t).carry + tSeg(t, now);
export const settleAt = (t, at) => { t = N(t); return { ...t, acc: t.acc + (t.runAt ? Math.max(0, at - t.runAt) / 1000 : 0), runAt: null, hb: at }; };   // freeze as of `at` (no clock guard: `at` is explicit)

// Split a session across local midnights (23:30 to 00:45 must credit both days). dkey = local-day formatter.
export function splitByDay(startMs, endMs, secs, dkey) {
  if (!(endMs > startMs)) return [{ day: dkey(new Date(startMs)), secs }];
  const out = [], span = endMs - startMs; let c = startMs;
  while (c < endMs) { const d = new Date(c), nx = Math.min(endMs, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()); out.push({ day: dkey(d), secs: (secs * (nx - c)) / span }); c = nx; }
  return out;
}
const bump = (log, day, sub, v) => { const row = { ...log[day] }, n = (row[sub] || 0) + v; if (n > 1e-6) row[sub] = n; else delete row[sub]; const o = { ...log }; if (Object.keys(row).length) o[day] = row; else delete o[day]; return o; };
// Replaces `commit` in timer.jsx: midnight-safe, stamps `u` (last-edit time) for future session sync.
export function commit(p, t, secs, end, id, dkey) {
  if (t.mode === 'break' || secs < 60) return p;
  const parts = splitByDay(t.ts, end, secs, dkey); let log = p.log;
  parts.forEach((x) => { log = bump(log, x.day, t.sub, x.secs); });
  return { ...p, log, sessions: [...(p.sessions || []), { id, day: parts[0].day, sub: t.sub, start: t.ts, end, secs, note: t.note || '', tag: t.tag || 'L', u: end }] };
}
// Replaces the subtract-from-one-day logic in api.undo / api.remove.
export function uncommit(p, id, dkey) {
  const x = (p.sessions || []).find((e) => e.id === id); if (!x) return p;
  let log = p.log; splitByDay(x.start, x.end, x.secs, dkey).forEach((q) => { log = bump(log, q.day, x.sub, -q.secs); });
  return { ...p, log, sessions: p.sessions.filter((e) => e.id !== id) };
}

// Crash journal: a tiny key written on EVERY start/pause/switch/note and every HB_MS, independent of the big state blob.
// So a full quota, a half-written blob or a dead battery still leaves the running timer on disk.
const TJ = 'gcc-timer-journal';
export const jWrite = (st, t, hb = Date.now()) => { try { st.setItem(TJ, JSON.stringify(t ? { t, hb } : null)); } catch {} };
export const jRead = (st) => { try { return JSON.parse(st.getItem(TJ)); } catch { return null; } };
// Call ONCE per cold start (not on visibilitychange: a locked screen is not a crash).
// Returns { t, src, ask }. ask = { last, gap } means: the app was silent for a long time, so let the user choose.
export function boot(mainTimer, j, now) {
  let t = mainTimer, hb = (t && t.hb) || 0, src = 'state';
  if (j && j.t && (!t || j.t.ts >= t.ts)) { t = j.t; hb = j.hb || 0; src = 'journal'; }
  if (t && hb) t = { ...t, hb };                    // after a cold boot the clock guard starts from the last heartbeat
  if (!t || !t.runAt) return { t, src, ask: null };
  const gap = hb ? now - hb : 0, long = tSeg(t, now) > MAX_H * 3600;
  return { t, src, ask: gap > GAP_MS || long ? { last: hb || t.runAt, gap, long } : null };
}

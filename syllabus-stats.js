// Per-chapter / per-subject numbers for the Syllabus view. Pure.
const live = (l) => !!l.date && l.date !== '—' && l.date !== '-';
export function chapterStats(c) {
  const L = (c && c.lectures) || [];
  let done = 0, partial = 0, dpps = 0, liveN = 0, leftSec = 0, unknown = 0;
  for (const l of L) {
    if (l.done) done++; else if (l.pw === 'partial') partial++;
    if (l.dpp) dpps++;
    if (live(l)) liveN++;
    if (!l.done) { if (l.dur > 0) leftSec += l.dur; else unknown++; }
  }
  return { total: L.length, done, partial, dpps, live: liveN, leftSec, unknown };
}
export function subjectStats(sub) {
  const t = { total: 0, done: 0, partial: 0, dpps: 0, live: 0, leftSec: 0, unknown: 0 };
  for (const c of (sub && sub.chapters) || []) { const x = chapterStats(c); for (const k in t) t[k] += x[k]; }
  return t;
}
export const fmtLeft = (st) => (st.leftSec ? `${(st.leftSec / 3600).toFixed(1)} h left` : '');

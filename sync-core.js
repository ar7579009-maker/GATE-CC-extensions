// Pure sync helpers (no DOM, no network) so they can be unit-tested.

// Keys that sync between devices. `log` is handled separately (per-device contributions, summed).
// Device-local on purpose: timer, theme, notify, remindAt, lastRemind, trayClose, tbaMigrated.
export const SYNCED = ['subjects', 'tests', 'mocks', 'pyq', 'rev', 'marks', 'rules', 'sched', 'revq', 'gantt', 'weights', 'target', 'goalH', 'targetDate', 'examDate', 'rule1Min', 'rule2Target', 'neglect', 'tsub', 'urgent', 'tPrior', 'plan'];

export const hash = (v) => {
  const s = JSON.stringify(v) ?? 'u'; let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36) + ':' + s.length;
};

// log = { 'YYYY-MM-DD': { subjectId: seconds } }.  logOp(a, b, +1) adds, logOp(a, b, -1) subtracts (never below 0).
export function logOp(a, b, sign) {
  const out = {};
  new Set([...Object.keys(a || {}), ...Object.keys(b || {})]).forEach((d) => {
    const row = {};
    new Set([...Object.keys(a?.[d] || {}), ...Object.keys(b?.[d] || {})]).forEach((k) => {
      const v = (a?.[d]?.[k] || 0) + sign * (b?.[d]?.[k] || 0);
      if (v > 1e-6) row[k] = v;
    });
    if (Object.keys(row).length) out[d] = row;
  });
  return out;
}
export const sumLogs = (list) => list.reduce((acc, l) => logOp(acc, l, 1), {});

// Lecture ticks: a lecture is done if EITHER device ticked it. Structure comes from the newer side.
export function mergeDone(local, remote, remoteNewer) {
  const base = remoteNewer ? remote : local, other = remoteNewer ? local : remote;
  const idx = new Map();
  (other || []).forEach((s) => s.chapters.forEach((c) => c.lectures.forEach((l) => idx.set(`${s.id}\u0000${c.name}\u0000${l.name}`, l))));
  return (base || []).map((s) => ({
    ...s,
    chapters: s.chapters.map((c) => ({
      ...c,
      lectures: c.lectures.map((l) => {
        const o = idx.get(`${s.id}\u0000${c.name}\u0000${l.name}`);
        if (!o) return l;
        const m = { ...l, done: !!(l.done || o.done) };
        if (l.pyq || o.pyq) m.pyq = l.pyq || o.pyq;
        return m;
      }),
    })),
  }));
}

// Returns null when the local value should stay as is, else { v, t, dirty }.
// dirty = the merged result differs from what the server has, so it must be pushed back.
export function mergeKey(k, localV, entry, remote) {
  const lt = entry?.t || 0, rNewer = remote.t > lt;
  if (k === 'subjects') { const v = mergeDone(localV, remote.v, rNewer); return { v, t: Math.max(lt, remote.t), dirty: hash(v) !== hash(remote.v) }; }
  if (k === 'mocks') {
    const have = new Set((remote.v || []).map((m) => m.id));
    const v = [...(remote.v || []), ...(localV || []).filter((m) => !have.has(m.id))].sort((x, y) => String(x.date).localeCompare(String(y.date)));
    return { v, t: Math.max(lt, remote.t), dirty: hash(v) !== hash(remote.v) };
  }
  return rNewer ? { v: remote.v, t: remote.t, dirty: false } : null;
}

// Sessions: union by id, newest edit (`u`) wins per id. Lets sessions sync like `log` does, or merge after a restore.
export function mergeSessions(a = [], b = []) {
  const m = new Map();
  [...a, ...b].forEach((e) => { const o = m.get(e.id); if (!o || (e.u || 0) >= (o.u || 0)) m.set(e.id, e); });
  return [...m.values()].sort((x, y) => x.start - y.start);
}

// Crash-safe persistence. Replaces:  localStorage.setItem(KEY, JSON.stringify(s))  and  load()'s catch -> hydrate({}).
// v7 problem: a failed JSON.parse silently starts from an EMPTY state, and the next save overwrites the damaged copy for good.
let lastBak = 0;
export function saveResilient(st, key, obj, now = Date.now()) {
  let json; try { json = JSON.stringify(obj); } catch { return { ok: false, why: 'serialize' }; }
  try {
    if (now - lastBak > 3e5) { const prev = st.getItem(key); if (prev) { st.setItem(key + ':bak', prev); lastBak = now; } }   // rolling backup, at most every 5 min
    st.setItem(key, json); return { ok: true };
  } catch {
    try { st.removeItem(key + ':bak'); st.setItem(key, json); return { ok: true, trimmed: true }; } catch { return { ok: false, why: 'quota' }; }   // surface this in the UI!
  }
}
export function loadResilient(st, key) {
  for (const k of [key, key + ':bak']) { try { const v = JSON.parse(st.getItem(k)); if (v && typeof v === 'object' && !Array.isArray(v)) return { v, from: k }; } catch {} }
  try { const raw = st.getItem(key); if (raw) st.setItem(key + ':corrupt', raw); } catch {}   // keep the damaged bytes for recovery
  return { v: null, from: null };
}

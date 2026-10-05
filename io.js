import { MARKS_MAP } from './data.js';

export const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
export const rowFor = (id) => MARKS_MAP.find((r) => r.sids.includes(id))?.id || null;
const isoDate = (x) => {
  x = String(x || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(x)) return x;
  const m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(x);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
};

export function parseCSV(t) {
  const rows = []; let r = [], c = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { r.push(c); c = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; r.push(c); c = ''; if (r.some((x) => x.trim())) rows.push(r); r = []; }
    else c += ch;
  }
  r.push(c); if (r.some((x) => x.trim())) rows.push(r);
  return rows;
}

// Converts the JS array literal in the checklist HTML (unquoted keys, single quotes, comments) into JSON.
function literalToJson(src, start) {
  let out = '', depth = 0, i = start;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1, v = '';
      while (j < src.length && src[j] !== ch) { if (src[j] === '\\') { v += src[j + 1]; j += 2; } else v += src[j++]; }
      out += JSON.stringify(v); i = j + 1; continue;
    }
    if (ch === '/' && src[i + 1] === '/') { const n = src.indexOf('\n', i); i = n < 0 ? src.length : n; continue; }
    if (ch === '/' && src[i + 1] === '*') { const n = src.indexOf('*/', i + 2); i = n < 0 ? src.length : n + 2; continue; }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i; while (j < src.length && /[\w$]/.test(src[j])) j++;
      const id = src.slice(i, j); let k = j; while (/\s/.test(src[k] || '')) k++;
      out += src[k] === ':' ? JSON.stringify(id) : id; i = j; continue;
    }
    if (ch === '[' || ch === '{') depth++;
    if (ch === ']' || ch === '}') { depth--; out += ch; i++; if (!depth) break; continue; }
    out += ch; i++;
  }
  return out.replace(/,(\s*[\]}])/g, '$1');
}

export function parseSyllabus(fn, text) {
  let arr;
  if (/\.csv$/i.test(fn)) {
    const [h, ...rows] = parseCSV(text);
    const H = (h || []).map((x) => x.trim().toLowerCase());
    const g = (r, k) => { const i = H.indexOf(k); return i < 0 ? '' : (r[i] || '').trim(); };
    if (H.indexOf('subject') < 0 || (H.indexOf('lecture') < 0 && H.indexOf('chapter') < 0)) throw new Error('CSV needs columns: subject, type, chapter, lecture, date, dpp');
    const map = new Map();
    rows.forEach((r) => {
      const sn = g(r, 'subject'); if (!sn) return;
      if (!map.has(sn)) map.set(sn, { name: sn, type: g(r, 'type'), chapters: [] });
      const S = map.get(sn), cn = g(r, 'chapter') || 'General';
      let C = S.chapters.find((c) => c.name === cn);
      if (!C) { C = { name: cn, lectures: [] }; S.chapters.push(C); }
      const ln = g(r, 'lecture');
      if (ln) C.lectures.push({ name: ln, date: g(r, 'date'), dpp: g(r, 'dpp') || undefined });
    });
    arr = [...map.values()];
  } else if (/\.html?$/i.test(fn)) {
    // Expand generator shorthand like ...[...Array(25)].map((_, i) => ({ name: `Lecture ${i+1}`, date: '-' }))
    const src = text.replace(/\.\.\.\[\.\.\.Array\((\d+)\)\]\.map\(\(\w+,\s*\w+\)\s*=>\s*\(\{((?:\$\{[^}]*\}|[^}])*)\}\)\)/g, (_, n, body) =>
      Array.from({ length: +n }, (_x, k) => '{' + body.replace(/\$\{\s*\w+\s*\+\s*1\s*\}/g, k + 1).replace(/\$\{\s*\w+\s*\}/g, k) + '}').join(','));
    const s = src.search(/const\s+subjects\s*=/);
    if (s < 0) throw new Error('No "const subjects = [...]" found in that HTML file');
    try { arr = JSON.parse(literalToJson(src, src.indexOf('[', s))); }
    catch { throw new Error('Could not read the subjects list from that HTML (it uses JavaScript I cannot parse). Use Export syllabus or a CSV instead.'); }
  } else {
    const j = JSON.parse(text); arr = Array.isArray(j) ? j : j.subjects;
  }
  if (!Array.isArray(arr) || !arr.length) throw new Error('No subjects found in the file');
  return arr.map((n) => {
    if (!n || !String(n.name || '').trim() || !Array.isArray(n.chapters)) throw new Error('Each subject needs a name and a chapters list');
    return {
      id: n.id ? String(n.id) : slug(n.name), name: String(n.name).trim(),
      type: n.type ? (/^rec/i.test(n.type) ? 'rec' : 'live') : undefined,
      ...(n.row !== undefined ? { row: n.row } : {}),
      chapters: n.chapters.map((c) => ({
        name: String(c.name || 'Chapter'),
        lectures: (c.lectures || []).map((l) => typeof l === 'string' ? { name: l } : { name: String(l.name || 'Lecture'), date: l.date || '', dpp: l.dpp || undefined, ...(l.done !== undefined ? { done: !!l.done } : {}) }),
      })),
    };
  });
}

const sameSub = (x, n) => x.id === n.id || x.name.toLowerCase() === n.name.toLowerCase();
export const countMatches = (cur, inc) => inc.filter((n) => cur.some((x) => sameSub(x, n))).length;

// Matching subjects update in place; ticks carry over by chapter name + lecture name.
export function mergeSubjects(cur, inc) {
  const out = [...cur];
  inc.forEach((n) => {
    const i = out.findIndex((x) => sameSub(x, n)), old = i >= 0 ? out[i] : null;
    const was = (cn, ln) => old?.chapters.find((c) => c.name === cn)?.lectures.find((l) => l.name === ln)?.done;
    const id = old?.id || n.id;
    const sub = {
      id, name: n.name, type: n.type || old?.type || 'live',
      row: n.row !== undefined ? n.row : old ? old.row : rowFor(id),
      chapters: n.chapters.map((c) => ({ name: c.name, lectures: c.lectures.map((l) => ({ ...l, done: !!(l.done ?? was(c.name, l.name)) })) })),
    };
    if (i >= 0) out[i] = sub; else out.push(sub);
  });
  return out;
}

export function parseTests(fn, text) {
  let arr;
  if (/\.csv$/i.test(fn)) {
    const [h, ...rows] = parseCSV(text);
    const H = (h || []).map((x) => x.trim().toLowerCase()), ix = (k) => H.indexOf(k);
    if (ix('name') < 0) throw new Error('CSV needs columns: name, date, marks');
    arr = rows.map((r) => ({ name: r[ix('name')], date: ix('date') >= 0 ? r[ix('date')] : '', marks: ix('marks') >= 0 ? r[ix('marks')] : 100 }));
  } else {
    const j = JSON.parse(text); arr = Array.isArray(j) ? j : j.tests;
  }
  if (!Array.isArray(arr)) throw new Error('Expected a list of tests');
  const out = arr.filter((t) => t && String(t.name || '').trim()).map((t) => ({ id: t.id ? String(t.id) : slug(t.name), name: String(t.name).trim(), date: isoDate(t.date), marks: +t.marks || 100 }));
  if (!out.length) throw new Error('No tests found in the file');
  return out;
}

const sameTest = (x, n) => x.id === n.id || x.name.toLowerCase() === n.name.toLowerCase();
export const countTestMatches = (cur, inc) => inc.filter((n) => cur.some((x) => sameTest(x, n))).length;
export function mergeTests(cur, inc) {
  const out = [...cur];
  inc.forEach((n) => {
    const i = out.findIndex((x) => sameTest(x, n));
    if (i >= 0) out[i] = { ...out[i], name: n.name, date: n.date || out[i].date, marks: n.marks };
    else out.push({ ...n, id: out.some((x) => x.id === n.id) ? `${n.id}-${Date.now()}` : n.id });
  });
  return out;
}

/* ───────── PW sync (kind: 'pw-sync', version 3) ───────── */
export const PW_SUBJECT_MAP = {
  'operating systems': 'os', 'theory of computation': 'toc', 'database management system': 'dbms', 'database management systems': 'dbms', dbms: 'dbms',
  'general aptitude': 'ga', 'verbal aptitude': 'verbal', 'c programming': 'cprog', 'fundamentals of c': 'fundc', 'fundamental of c language': 'fundc', 'fundamentals of c language': 'fundc',
  'basics of computer system': 'bcs', 'basics of computer systems': 'bcs', 'computer networks': 'cn',
  'computer organization and architecture': 'coa', 'computer organisation and architecture': 'coa', coa: 'coa',
  'calculus and optimization': 'calculus', 'linear algebra': 'linear',
  'foundation of engineering math': 'engmaths', 'foundation of engineering maths': 'engmaths', 'foundation engineering math': 'engmaths', 'foundation engineering maths': 'engmaths',
};
const normName = (t) => String(t || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const normChapter = (t) => normName(String(t || '').replace(/^\s*ch(?:apter)?\s*0*\d+\s*[·:.\-–]?\s*/i, ''));
const normTest = (t) => String(t || '').toLowerCase().replace(/[:·]/g, ' ').replace(/\s+/g, ' ').trim();
const dayOf = (iso) => (iso ? String(iso).slice(0, 10) : '');
const subjectId = (name) => PW_SUBJECT_MAP[normName(name)] || null;

export function isPwSync(o) { return !!o && o.kind === 'pw-sync' && Array.isArray(o.subjects); }

export function applyPwSync(state, snap) {
  const report = { ticked: 0, lecturesMatched: 0, newTests: 0, updatedTests: 0, newResults: 0, updatedResults: 0, unmatched: [], mismatch: [] };
  const subjects = (state.subjects || []).map((s) => s);          // copy-on-write below
  const byId = new Map(subjects.map((s, i) => [s.id, i]));

  for (const ps of snap.subjects || []) {
    if (/^(digital logic|starter kit|notices)$/.test(normName(ps.name))) continue;
    if (!(ps.chapters || []).length) continue;
    const id = subjectId(ps.name);
    if (!id || !byId.has(id)) { report.unmatched.push(ps.name); continue; }
    const i = byId.get(id), app = subjects[i];
    const used = new Set();
    const pwByName = new Map();
    (ps.chapters || []).forEach((pc, k) => { const n = normChapter(pc.name); if (!pwByName.has(n)) pwByName.set(n, k); });
    const chapters = app.chapters.map((ac, ci) => {
      let k = pwByName.get(normChapter(ac.name));
      if (k == null || used.has(k)) k = (ps.chapters[ci] && !used.has(ci)) ? ci : null;
      if (k == null) { report.mismatch.push(`${app.name} › ${ac.name} (no PW chapter)`); return ac; }
      used.add(k);
      const pcs = ps.chapters[k].lectures || [];
      const n = Math.min(pcs.length, ac.lectures.length);
      if (pcs.length !== ac.lectures.length) report.mismatch.push(`${app.name} › ${ac.name} (app ${ac.lectures.length}, PW ${pcs.length})`);
      const lectures = ac.lectures.map((l, li) => {
        if (li >= n) return l;
        const p = pcs[li]; report.lecturesMatched++;
        const nl = { ...l, pw: p.state, dur: p.durSec };
        if (p.state === 'done' && !l.done) { nl.done = true; report.ticked++; }
        return nl;
      });
      return { ...ac, lectures };
    });
    subjects[i] = { ...app, chapters };
  }

  // tests
  const tests = [...(state.tests || [])];
  const idxByName = new Map(), idxById = new Map();
  tests.forEach((t, i) => { idxByName.set(normTest(t.name), i); idxById.set(t.id, i); });
  const testFor = new Map();   // pw test id -> app test id
  for (const pt of snap.tests || []) {
    let i = idxByName.get(normTest(pt.name));
    if (i == null) i = idxById.get(pt.id);
    const date = dayOf(pt.start);
    if (i != null) {
      const t = tests[i];
      tests[i] = { ...t, ...(date ? { date } : {}), ...(pt.marks != null ? { marks: pt.marks } : {}), ...(pt.mins != null ? { mins: pt.mins } : {}), pwId: pt.id };
      testFor.set(pt.id, t.id); report.updatedTests++;
    } else {
      const t = { id: 'pw-' + pt.id, name: pt.name, date, marks: pt.marks, mins: pt.mins, q: pt.q, source: 'pw', pwId: pt.id };
      tests.push(t); idxByName.set(normTest(t.name), tests.length - 1); idxById.set(t.id, tests.length - 1);
      testFor.set(pt.id, t.id); report.newTests++;
    }
  }

  // results -> mocks
  const mocks = [...(state.mocks || [])];
  const mIdx = new Map(); mocks.forEach((m, i) => { if (m.pwResultId) mIdx.set(m.pwResultId, i); });
  let attempted = 0;
  for (const r of snap.results || []) {
    const key = r.mappingId || `${r.testId}#${r.attemptNo || 1}`;
    attempted++;
    const f = { test: testFor.get(r.testId) || 'custom', name: r.name, date: dayOf(r.endedAt), score: r.score, max: r.max, correct: r.correct, incorrect: r.incorrect, skipped: r.skipped, accuracy: r.accuracy, timeSec: r.timeSec };
    if (mIdx.has(key)) { mocks[mIdx.get(key)] = { ...mocks[mIdx.get(key)], ...f }; report.updatedResults++; }
    else { mocks.push({ id: 'pwr-' + key, pwResultId: key, ...f }); mIdx.set(key, mocks.length - 1); report.newResults++; }
  }

  const subj = {};
  for (const ps of snap.subjects || []) {
    const id = subjectId(ps.name);
    if (id && ps.pw) subj[id] = { total: ps.pw.total, completed: ps.pw.completed, pct: ps.pw.pct };
  }
  const pwSync = { updated: snap.updated, batchName: snap.batch?.name || '', totals: snap.totals || {}, subjects: subj, testCount: (snap.tests || []).length, attempted };
  return { subjects, tests, mocks, pwSync, report };
}

// Auto-import gate: only apply a snapshot that is valid and newer than the last applied one.
export function parsePwText(text) { try { const o = JSON.parse(text); return isPwSync(o) ? o : null; } catch { return null; } }
export const pwIsNewer = (snap, last) => !!snap && (!last?.updated || Date.parse(snap.updated) > Date.parse(last.updated));
export function pwToast(report) {
  const w = [];
  if (report.unmatched.length) w.push(`unmatched: ${report.unmatched.join(', ')}`);
  if (report.mismatch.length) w.push(`${report.mismatch.length} chapter mismatch${report.mismatch.length > 1 ? 'es' : ''}`);
  return { msg: `PW synced: ${report.ticked} lecture${report.ticked === 1 ? '' : 's'} done`, warn: w.join(' · ') };
}

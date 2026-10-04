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

/* ─────────────────────────────────────────────────────────────────────────
   PW Extension import  (reads files the extension saved to PW-GATE/data/)
   ─────────────────────────────────────────────────────────────────────── */

// Status string from a lecture item's "status" field in the extension data
const DONE_STATUS = /^(watch again|resume)$/i;

// Convert a chapter file (version 2 JSON) into ticked/unticked lectures
// Returns { subjectName, chapterName, lectures: [{name, done}] }
function chapterFileToLectures(obj) {
  if (!obj || obj.kind !== 'chapter') return null;
  const items = obj.lectures?.items;
  if (!Array.isArray(items) || !items.length) return null;
  return {
    subjectName: String(obj.subject || '').trim(),
    chapterName: String(obj.chapter || '').trim(),
    sfx: obj.duplicateName ? (obj.lectures?.sfx || '') : '',
    lectures: items.map((it) => ({
      name: String(it.title || it.name || '').trim(),
      done: DONE_STATUS.test(String(it.status || '')),
    })).filter((l) => l.name),
  };
}

// Convert the extension's dashboard JSON into a summary object
// Returns { date, subjectRows: [{name, lecturesDone, lecturesTotal}], tests: {...} | null }
function parseDashboardFile(obj) {
  if (!obj || obj.kind !== 'dashboard') return null;
  const subjects = (obj.subjects || []).map((s) => ({
    name: String(s.name || '').trim(),
    lecturesDone: Array.isArray(s.lectures) ? s.lectures[0] : 0,
    lecturesTotal: Array.isArray(s.lectures) ? s.lectures[1] : 0,
  })).filter((s) => s.name);
  return {
    date: obj.updated ? obj.updated.slice(0, 10) : '',
    subjects,
    tests: obj.tests || null,
  };
}

// Convert extension test files (tests-batch.json / tests-series.json) to GCC test format
function parseTestFile(obj, existingTests) {
  if (!obj || obj.kind !== 'tests' || !Array.isArray(obj.tests)) return [];
  const isoDate = (s) => {
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return s;
  };
  return obj.tests
    .filter((t) => t && String(t.name || '').trim())
    .map((t) => ({
      id: t.id ? String(t.id) : slug(t.name),
      name: String(t.name).trim(),
      date: isoDate(t.when?.date || t.date || ''),
      marks: t.marks || 100,
      _state: String(t.state || '').toLowerCase(), // 'missed' | 'upcoming' | 'live' | 'attempted'
    }));
}

// Given a set of chapter file payloads and current subjects, build a
// map of subject → { [chapterName]: [{name,done}] } covering only the
// chapters whose done status differs from what is already ticked.
function buildTickDelta(chapterPayloads, curSubjects) {
  const bySubCh = {}; // subject_lower → chapter_lower → [{name,done}]
  for (const p of chapterPayloads) {
    const r = chapterFileToLectures(p);
    if (!r) continue;
    const sk = r.subjectName.toLowerCase(), ck = r.chapterName.toLowerCase();
    if (!bySubCh[sk]) bySubCh[sk] = {};
    bySubCh[sk][ck] = r.lectures;
  }
  // For each current subject, see how many extra ticks exist in PW vs app
  const deltas = []; // {subjectName, chapterName, toTick: number, total: number}
  for (const sub of curSubjects) {
    const sk = sub.name.toLowerCase();
    const pwSub = bySubCh[sk] || bySubCh[Object.keys(bySubCh).find((k) => k.includes(sk.split(' ')[0])) || ''];
    if (!pwSub) continue;
    for (const ch of sub.chapters) {
      const ck = ch.name.toLowerCase();
      const pwLecs = pwSub[ck] || pwSub[Object.keys(pwSub).find((k) => k.includes(ck.split(' ')[0])) || ''];
      if (!pwLecs) continue;
      let toTick = 0;
      for (let i = 0; i < ch.lectures.length && i < pwLecs.length; i++) {
        if (!ch.lectures[i].done && pwLecs[i].done) toTick++;
      }
      if (toTick > 0) deltas.push({ subjectName: sub.name, chapterName: ch.name, toTick, total: ch.lectures.length });
    }
  }
  return { bySubCh, deltas };
}

/**
 * parsePWFiles — main entry point.
 * @param {Array<{name: string, text: string}>} files  — file contents loaded by the UI
 * @param {Array} curSubjects — current app subjects
 * @param {Array} curTests — current app tests
 * @returns {Object} preview payload fed to the ImportFromPW component
 */
export function parsePWFiles(files, curSubjects, curTests) {
  const byName = {};
  for (const f of files) byName[f.name.toLowerCase()] = f.text;

  const chapterPayloads = [];
  let dashPayload = null, batchPayload = null, seriesPayload = null;

  for (const f of files) {
    let obj;
    try { obj = JSON.parse(f.text); } catch { continue; }
    const n = f.name.toLowerCase();
    if (n === 'dashboard.json' || obj.kind === 'dashboard') { dashPayload = obj; continue; }
    if (n === 'tests-batch.json' || (obj.kind === 'tests' && obj.source === 'batch')) { batchPayload = obj; continue; }
    if (n === 'tests-series.json' || (obj.kind === 'tests' && obj.source === 'series')) { seriesPayload = obj; continue; }
    if (obj.kind === 'chapter') { chapterPayloads.push(obj); continue; }
    // index.json — extract embedded lectures array
    if (obj.kind === undefined && Array.isArray(obj.lectures)) {
      for (const lec of obj.lectures) {
        if (lec.subject && lec.chapter && Array.isArray(lec.items)) {
          chapterPayloads.push({ kind: 'chapter', subject: lec.subject, chapter: lec.chapter, duplicateName: lec.duplicateName, lectures: lec });
        }
      }
    }
  }

  const dashboard = dashPayload ? parseDashboardFile(dashPayload) : null;
  const { bySubCh, deltas } = buildTickDelta(chapterPayloads, curSubjects);

  const batchTests = batchPayload ? parseTestFile(batchPayload, curTests) : [];
  const seriesTests = seriesPayload ? parseTestFile(seriesPayload, curTests) : [];
  const allNewTests = [...batchTests, ...seriesTests];
  const newTestCount = allNewTests.filter((t) => !curTests.some((x) => sameTest(x, t))).length;
  const updTestCount = allNewTests.filter((t) => curTests.some((x) => sameTest(x, t))).length;

  const totalToTick = deltas.reduce((a, d) => a + d.toTick, 0);
  const chaptersRead = chapterPayloads.length;
  const hasData = totalToTick > 0 || allNewTests.length > 0;

  return {
    hasData,
    chaptersRead,
    dashboard,
    deltas,      // [{subjectName, chapterName, toTick, total}] — only subjects with new ticks
    totalToTick,
    allTests: allNewTests,
    newTestCount,
    updTestCount,
    _bySubCh: bySubCh,  // internal for apply
    _chapterPayloads: chapterPayloads,
  };
}

/**
 * applyPWImport — called when user clicks Apply in the ImportFromPW modal.
 * Ticks lectures (never un-ticks), merges tests.
 */
export function applyPWImport(preview, curSubjects, curTests, { includeTicks, includeTests }) {
  let subjects = curSubjects;
  if (includeTicks && preview.deltas.length) {
    subjects = curSubjects.map((sub) => {
      const sk = sub.name.toLowerCase();
      const pwSub = preview._bySubCh[sk] || preview._bySubCh[Object.keys(preview._bySubCh).find((k) => k.includes(sk.split(' ')[0])) || ''];
      if (!pwSub) return sub;
      return {
        ...sub,
        chapters: sub.chapters.map((ch) => {
          const ck = ch.name.toLowerCase();
          const pwLecs = pwSub[ck] || pwSub[Object.keys(pwSub).find((k) => k.includes(ck.split(' ')[0])) || ''];
          if (!pwLecs) return ch;
          return {
            ...ch,
            lectures: ch.lectures.map((l, i) => ({
              ...l,
              done: l.done || !!(pwLecs[i]?.done),  // never un-tick
            })),
          };
        }),
      };
    });
  }
  let tests = curTests;
  if (includeTests && preview.allTests.length) {
    tests = mergeTests(curTests, preview.allTests.map(({ _state, ...t }) => t));
  }
  return { subjects, tests };
}

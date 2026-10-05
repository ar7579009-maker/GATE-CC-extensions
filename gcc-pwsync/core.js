// Pure crawl logic for the PW sync. No DOM, no chrome.* APIs, so it can be tested in Node.
// It only calls the same JSON endpoints the PW site itself uses, one at a time, with a short pause between calls.
(function (root) {
  'use strict';
  const API = 'https://api.penpencil.co';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const hms = (s) => { const m = /^(\d+):(\d{2}):(\d{2})$/.exec(String(s || '')); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0; };
  const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

  class HttpError extends Error {
    constructor(status, path) { super(`HTTP ${status} on ${path.split('?')[0]}`); this.status = status; this.auth = status === 401 || status === 403; }
  }

  function makeApi({ fetchFn, getHeaders, gapMs = 250, retries = 3 }) {
    let last = 0, calls = 0, cred;                 // cred: undefined = page default; switches to 'include' if the browser blocks the first try
    async function req(method, path, body) {
      for (let i = 0; ; i++) {
        const wait = last + gapMs - Date.now(); if (wait > 0) await sleep(wait); last = Date.now(); calls++;
        const headers = { ...getHeaders() }; if (body !== undefined) headers['content-type'] = 'application/json';
        const init = { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };
        if (cred) init.credentials = cred;
        let res;
        try { res = await fetchFn(API + path, init); }
        catch (e) {
          if (!cred) { cred = 'include'; continue; }
          if (i >= retries) throw e; await sleep(800 * (i + 1)); continue;
        }
        if (res.status === 429 || res.status >= 500) { if (i >= retries) throw new HttpError(res.status, path); await sleep(1500 * (i + 1)); continue; }
        if (!res.ok) throw new HttpError(res.status, path);
        return res.json();
      }
    }
    return { get: (p) => req('GET', p), post: (p, b) => req('POST', p, b), calls: () => calls };
  }

  const normLecture = (it) => {
    const d = it.data || {}, v = d.videoDetails || {};
    return {
      id: d._id || it._id, title: String(d.topic || v.name || '').trim(), date: d.date || d.startTime || null,
      durSec: hms(v.duration), live: d.lectureType === 'LIVE', released: !!(v.duration || v.status === 'Ready'),
      status: d.status || '', dpp: d.dppCount || 0,
    };
  };
  const byDateThenTitle = (a, b) => (a.date || '').localeCompare(b.date || '') || a.title.localeCompare(b.title, undefined, { numeric: true });

  const normTest = (t, source, modeName) => ({
    id: t._id, name: t.name, source, series: modeName || '', type: t.currentType || t.type || '',
    q: t.totalQuestions || 0, marks: t.totalMarks || 0, mins: t.maxDuration || 0,
    start: t.startTime || null, end: t.endTime || null, resultAt: t.resultScheduleAt || null,
    attempts: t.attempts || 0, activity: t.testActivityStatus || '', action: t.tag2 || t.tag1 || '',
    mappingId: t.testStudentMappingId || null, awaiting: !!t.isResultAwaiting,
  });

  const normResult = (test, r, mappingId, n) => {
    const yp = r.yourPerformance || {};
    return {
      testId: test.id, name: test.name, mappingId, attemptNo: n, endedAt: (r.testStudentMapping || {}).endedAt || null,
      score: yp.userScore, max: yp.totalScore, correct: yp.correctQuestions, incorrect: yp.inCorrectQuestions,
      skipped: yp.unAttemptedQuestions, attempted: yp.attemptedQuestions, accuracy: yp.accuracy, timeSec: yp.timeTaken,
      marksGained: yp.correctScore, marksLost: yp.inCorrectScore,
      sections: (r.sections || []).map((s) => ({
        name: (s.sectionId || {}).name || '', score: s.userScore, max: s.totalScore, correct: s.correctQuestions,
        incorrect: s.inCorrectQuestions, skipped: s.unAttemptedQuestions, accuracy: s.accuracy, timeSec: s.timeTaken,
      })),
    };
  };

  function summarize(subjects) {
    const s = { lectures: 0, done: 0, partial: 0, unreleased: 0, totalSec: 0, remainingSec: 0, chapters: 0 };
    subjects.forEach((sub) => sub.chapters.forEach((c) => { s.chapters++; c.lectures.forEach((l) => {
      s.lectures++; if (!l.released) s.unreleased++;
      s.totalSec += l.durSec;
      if (l.state === 'done') s.done++;
      else { if (l.state === 'partial') s.partial++; s.remainingSec += l.state === 'partial' ? Math.max(0, l.durSec - (l.pos || 0)) : l.durSec; }
    }); }));
    return s;
  }

  async function crawl(api, o = {}) {
    const log = o.log || (() => {}), progress = o.progress || (() => {}), cancelled = o.cancelled || (() => false);
    const warnings = [], t0 = Date.now();
    const warn = (m) => { warnings.push(m); log('! ' + m); };
    const safe = async (label, fn, dflt) => { try { return await fn(); } catch (e) { if (e.auth || e.cancelled) throw e; warn(`${label}: ${e.message}`); return dflt; } };
    const stop = () => { if (cancelled()) throw Object.assign(new Error('Cancelled'), { cancelled: true }); };
    const pct = (a, b, f) => progress({ pct: Math.round(a + (b - a) * Math.max(0, Math.min(1, f))) });

    // 1. which batch
    progress({ pct: 1, msg: 'Finding your batch' });
    const purchased = await api.get('/v3/batches/all-purchased-batches');
    const list = (purchased.data || []).map((x) => x.batch).filter(Boolean);
    const match = o.batchMatch || /parakram/i;
    const b = (o.batchId && list.find((x) => x._id === o.batchId)) || list.find((x) => match.test(x.name) && /gate\s*2027/i.test(x.name)) || list.find((x) => match.test(x.name));
    if (!b) throw new Error('No Parakram batch found among your purchased batches');
    const bid = b._id; log(`Batch: ${b.name}`);

    // 2. user id (needed for the watch-state call)
    let uid = o.userId;
    if (!uid) { const r = await safe('user id', () => api.get(`/v3/performance/lecture/subjects?batchId=${bid}`), null); uid = r && r.data && r.data[0] && r.data[0].userId; }
    if (!uid) throw new Error('Could not work out your user id');

    // 3. subjects + their progress
    progress({ pct: 3, msg: 'Reading subjects' });
    const det = await api.get(`/v3/batches/${bid}/details`);
    const subjects = ((det.data || {}).subjects || []).map((s, i) => ({ id: s._id, name: s.subject || s.name || '', order: s.displayOrder == null ? i : s.displayOrder, resources: !!s.isResources }));
    const prog = new Map();
    for (let p = 1; p <= 10; p++) {
      const r = await safe('subject progress', () => api.get(`/uxncc-be-go/stats/v1/batch/${bid}/subject/progress?page=${p}&limit=20`), null);
      const d = (r && r.data) || []; d.forEach((x) => prog.set(x.subjectId, x)); if (d.length < 20) break;
    }
    subjects.forEach((s) => {
      const x = prog.get(s.id) || {};
      s.pw = { total: x.totalLectures || 0, completed: x.completedLectures || 0, dppTotal: x.totalDPP || 0, dppDone: x.submittedDPP || 0, pct: x.progressPercentage || 0 };
      s.chapters = [];
    });
    const active = subjects.filter((s) => s.pw.total > 0);
    log(`${active.length} subjects with lectures`);

    // 4. pass A: chapters + chapter progress per subject
    for (let i = 0; i < active.length; i++) {
      stop(); const s = active[i]; progress({ msg: `Chapters: ${s.name}` }); pct(5, 15, i / active.length);
      const topics = [];
      for (let p = 1; p <= 20; p++) {
        const r = await safe(`${s.name} chapters`, () => api.get(`/batch-service/v1/batch-tags/${bid}/subject/${s.id}/topics?page=${p}&batchTagType=UNITS&limit=20`), null);
        const d = (r && r.data) || []; topics.push(...d); const tot = r && r.paginate && r.paginate.totalCount;
        if (d.length < 20 || (tot && topics.length >= tot)) break;
      }
      const cp = new Map();
      for (let p = 1; p <= 10; p++) {
        const r = await safe(`${s.name} chapter progress`, () => api.get(`/uxncc-be-go/stats/v1/batch/${bid}/subject/${s.id}/chapter/progress?page=${p}&enabled=true`), null);
        let added = 0; ((r && r.data) || []).forEach((x) => { if (!cp.has(x.tagId)) { cp.set(x.tagId, x); added++; } }); if (!added) break;
      }
      topics.sort((a, c) => (a.displayOrder || 0) - (c.displayOrder || 0)).forEach((t) => {
        const x = cp.get(t._id);
        s.chapters.push({
          id: t._id, name: t.name, order: t.displayOrder || 0, notes: t.notes || 0, videos: t.videos || 0, lectureVideos: t.lectureVideos || 0,
          pw: x ? { done: x.lecturesCompleted, total: x.totalLectures, dppDone: x.dppCompleted, dppTotal: x.totalDPP } : null, lectures: [],
        });
      });
    }

    // 5. pass B: lectures per chapter
    const todo = []; active.forEach((s) => s.chapters.forEach((c) => { if (c.videos > 0 || c.lectureVideos > 0 || (c.pw && c.pw.total > 0)) todo.push([s, c]); }));
    for (let i = 0; i < todo.length; i++) {
      stop(); const [s, c] = todo[i]; progress({ msg: `Lectures: ${s.name} › ${c.name}` }); pct(15, 70, i / Math.max(1, todo.length));
      const items = [];
      for (let skip = 0; skip < 2000; skip += 20) {
        const r = await safe(`${c.name} lectures`, () => api.get(`/batch-service/v3/batch-subject-schedules/${bid}/subject/${s.id}/contents?skip=${skip}&limit=20&contentType=ALL&contentFilter=ALL&tagId=${c.id}`), null);
        const d = (r && r.data) || []; items.push(...d); if (d.length < 20) break;
      }
      c.lectures = items.filter((x) => x.type === 'LECTURE').map(normLecture).sort(byDateThenTitle);
      c.noteFiles = items.filter((x) => x.type === 'NOTES').length;
    }

    // 6. pass C: what you have watched
    let si = 0;
    for (const s of active) {
      stop(); progress({ msg: `Watch progress: ${s.name}` }); pct(70, 80, si++ / active.length);
      const lecs = []; s.chapters.forEach((c) => c.lectures.forEach((l) => lecs.push(l)));
      const rows = new Map();
      for (const ids of chunk(lecs.map((l) => l.id), 20)) {
        const r = await safe(`${s.name} watch progress`, () => api.get(`/v3/video-stats/fetch-stats?userId=${uid}&typeId=${encodeURIComponent(ids.join(','))}`), null);
        ((r && r.data) || []).forEach((x) => rows.set(x.typeId, x));
      }
      lecs.forEach((l) => {
        const x = rows.get(l.id); l.state = x ? (x.isComplete ? 'done' : 'partial') : 'new';
        if (x) { l.pos = x.lastWatchedPointInSec || 0; l.len = x.videoLength || 0; l.at = x.modifiedAt || null; }
      });
      s.chapters.forEach((c) => { c.lecturesTotal = c.lectures.length; c.lecturesDone = c.lectures.filter((l) => l.state === 'done').length; });
      s.ours = { total: lecs.length, done: lecs.filter((l) => l.state === 'done').length };
    }

    // 7. tests (batch tests, then every series mode in this batch)
    progress({ pct: 81, msg: 'Reading tests' });
    const tests = new Map();
    const add = (arr, src, mode) => (arr || []).forEach((t) => { if (t && t._id && !tests.has(t._id)) tests.set(t._id, normTest(t, src, mode)); });
    const bt = await safe('batch tests', () => api.get(`/v3/test-service/tests?testType=All&testStatus=All&attemptStatus=All&batchId=${bid}&isSubjective=false&isPurchased=true`), null);
    add(bt && bt.data, 'batch', '');
    const modes = await safe('series list', () => api.get(`/batch-service/v1/batch-plans/${bid}/offering-data?page=1&type=TEST_CATEGORY_MODE&limit=20`), null);
    for (const m of (modes && modes.data) || []) {
      stop(); if (!m.categoryModeId) continue;
      const r = await safe(`series ${m.name}`, () => api.get(`/v3/test-service/tests?testModeId=${m.categoryModeId}&testType=All&testStatus=All&attemptStatus=All&isSubjective=false&isPurchased=true`), null);
      add(r && r.data, 'series', m.name);
    }

    // 8. results of attempted tests
    const attempted = [...tests.values()].filter((t) => t.attempts > 0 && !t.awaiting);
    const results = [];
    for (let i = 0; i < attempted.length; i++) {
      stop(); const t = attempted[i]; progress({ msg: `Result: ${t.name}` }); pct(85, 99, i / Math.max(1, attempted.length));
      let ids = t.mappingId ? [t.mappingId] : [];
      if (!ids.length) {
        const m = await safe(`${t.name} attempt`, () => api.post('/v3/test-service/tests/user-test-student-mapping-list', { testId: [t.id] }), null);
        ((m && m.data) || []).forEach((x) => { const id = x.testStudentMapping && x.testStudentMapping._id; if (id) ids.push(id); });
      }
      const done = new Set();
      while (ids.length) {
        const mid = ids.shift(); if (done.has(mid)) continue; done.add(mid);
        const r = await safe(`${t.name} result`, () => api.get(`/v3/test-service/tests/${t.id}/my-result?testId=${t.id}&testMappingId=${mid}`), null);
        const d = r && r.data; if (!d) continue;
        ((d.attemptFilter) || []).forEach((a) => { if (a.testStudentMappingId && !done.has(a.testStudentMappingId)) ids.push(a.testStudentMappingId); });
        results.push(normResult(t, d, mid, 0));
      }
    }
    const perTest = {}; results.sort((a, c) => (a.endedAt || '').localeCompare(c.endedAt || '')).forEach((r) => { perTest[r.testId] = (perTest[r.testId] || 0) + 1; r.attemptNo = perTest[r.testId]; });

    subjects.sort((a, c) => a.order - c.order);
    const out = {
      kind: 'pw-sync', version: 3, updated: new Date().toISOString(), batch: { id: bid, name: b.name },
      totals: summarize(active), subjects: active, tests: [...tests.values()], results,
      meta: { calls: api.calls(), seconds: Math.round((Date.now() - t0) / 1000), warnings },
    };
    progress({ pct: 100, msg: 'Done' });
    return out;
  }

  const api = { crawl, makeApi, summarize, hms, normLecture, normTest, normResult, HttpError };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GCCCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

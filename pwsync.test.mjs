import assert from 'node:assert';
import { applyPwSync, isPwSync, parsePwText, pwIsNewer, pwToast } from './io.js';
const L = (n, done = false) => ({ name: n, date: '', done });
const state = {
  subjects: [
    { id: 'os', name: 'Operating Systems', chapters: [{ name: 'CPU Scheduling', lectures: [L('a'), L('b', true), L('c')] }] },
    { id: 'linear', name: 'Linear Algebra', chapters: [{ name: 'CH 02 · Rank and System of Equations', lectures: [L('x'), L('y')] }] },
    { id: 'toc', name: 'TOC', chapters: [{ name: 'DFA', lectures: [L('1'), L('2')] }] },
  ],
  tests: [{ id: 'law1', name: 'Linear Algebra · Weekly Test 01', date: '2026-01-01', marks: 10, note: 'mine' }],
  mocks: [{ id: 'pwr-m1', pwResultId: 'm1', test: 'law1', name: 'old', score: 1, max: 20, concept: 3, silly: 2 }],
};
const lec = (state_, durSec = 100) => ({ title: 't', durSec, state: state_ });
const snap = {
  kind: 'pw-sync', version: 3, updated: '2026-10-05T00:00:00Z', batch: { name: 'B' }, totals: { done: 3 },
  subjects: [
    { id: 'p1', name: 'Operating Systems', pw: { total: 3, completed: 1, pct: 33 }, chapters: [{ name: 'CPU Scheduling', lectures: [lec('done'), lec('new'), lec('partial')] }] },
    { id: 'p2', name: 'Linear Algebra', pw: { total: 2, completed: 0, pct: 0 }, chapters: [{ name: 'CH 02 : Rank and System of Equation', lectures: [lec('new'), lec('new')] }] },
    { id: 'p3', name: 'Theory of Computation', pw: { total: 3, completed: 0, pct: 0 }, chapters: [{ name: 'DFA', lectures: [lec('done'), lec('done'), lec('done')] }] },
    { id: 'p4', name: 'Digital Logic', pw: {}, chapters: [{ name: 'X', lectures: [lec('done')] }] },
    { id: 'p5', name: 'Mystery Subject', pw: {}, chapters: [{ name: 'X', lectures: [lec('done')] }] },
    { id: 'p6', name: 'Starter Kit', pw: {}, chapters: [] },
  ],
  tests: [
    { id: 't1', name: 'Linear Algebra : Weekly Test 01', start: '2026-10-04T03:00:00Z', marks: 20, mins: 30, q: 13 },
    { id: 't2', name: 'New Test', start: '2026-10-09T03:00:00Z', marks: 50, mins: 60, q: 20 },
  ],
  results: [{ testId: 't1', name: 'Linear Algebra : Weekly Test 01', mappingId: 'm1', endedAt: '2026-10-04T22:11:00Z', score: 2.71, max: 20, correct: 4, incorrect: 9, skipped: 0, accuracy: 30.77, timeSec: 31 }],
};
assert.ok(isPwSync(snap)); assert.ok(!isPwSync({ kind: 'x' }));
const before = JSON.stringify(state);
const r = applyPwSync(state, snap);
assert.strictEqual(JSON.stringify(state), before, 'input not mutated');
// ticks: only added, manual tick stays, pw/dur stored
const os = r.subjects[0].chapters[0].lectures;
assert.deepStrictEqual(os.map((l) => l.done), [true, true, false]);
assert.deepStrictEqual(os.map((l) => l.pw), ['done', 'new', 'partial']); assert.strictEqual(os[0].dur, 100);
assert.strictEqual(os[1].name, 'b');
// chapter name normalisation ("CH 02 ·" vs "CH 02 :", Equation vs Equations -> order fallback)
assert.strictEqual(r.subjects[1].chapters[0].lectures[0].pw, 'new');
// count mismatch: min() matched, reported
assert.deepStrictEqual(r.subjects[2].chapters[0].lectures.map((l) => l.done), [true, true]);
assert.ok(r.report.mismatch.some((m) => m.includes('DFA')));
assert.deepStrictEqual(r.report.unmatched, ['Mystery Subject']);   // Digital Logic / Starter Kit silently ignored
// tests: match by normalised name keeps user fields; unmatched added
assert.strictEqual(r.tests[0].note, 'mine'); assert.strictEqual(r.tests[0].date, '2026-10-04'); assert.strictEqual(r.tests[0].marks, 20); assert.strictEqual(r.tests[0].mins, 30);
assert.deepStrictEqual(r.tests[1], { id: 'pw-t2', name: 'New Test', date: '2026-10-09', marks: 50, mins: 60, q: 20, source: 'pw', pwId: 't2' });
// results: upsert keeps error tags
assert.strictEqual(r.mocks.length, 1);
assert.strictEqual(r.mocks[0].score, 2.71); assert.strictEqual(r.mocks[0].concept, 3); assert.strictEqual(r.mocks[0].silly, 2); assert.strictEqual(r.mocks[0].test, 'law1');
// summary is small
assert.deepStrictEqual(Object.keys(r.pwSync).sort(), ['attempted', 'batchName', 'subjects', 'testCount', 'totals', 'updated']);
assert.deepStrictEqual(r.pwSync.subjects.os, { total: 3, completed: 1, pct: 33 });
// idempotent re-sync
const r2 = applyPwSync({ ...state, subjects: r.subjects, tests: r.tests, mocks: r.mocks }, snap);
assert.strictEqual(r2.report.ticked, 0); assert.strictEqual(r2.report.newTests, 0); assert.strictEqual(r2.report.newResults, 0);
assert.strictEqual(r2.tests.length, 2); assert.strictEqual(r2.mocks.length, 1);
// new result creates a mock
const r3 = applyPwSync(state, { ...snap, results: [{ ...snap.results[0], mappingId: 'm9', testId: 'zz' }] });
assert.strictEqual(r3.mocks.length, 2); assert.strictEqual(r3.mocks[1].test, 'custom');
// auto-import gate
assert.strictEqual(parsePwText('{half'), null); assert.strictEqual(parsePwText('{"kind":"other","subjects":[]}'), null);
assert.ok(parsePwText(JSON.stringify(snap)));
assert.ok(pwIsNewer(snap, undefined)); assert.ok(pwIsNewer(snap, { updated: '2026-10-04T00:00:00Z' }));
assert.ok(!pwIsNewer(snap, { updated: snap.updated })); assert.ok(!pwIsNewer(snap, { updated: '2026-10-06T00:00:00Z' })); assert.ok(!pwIsNewer(null, undefined));
assert.deepStrictEqual(pwToast({ ticked: 58, unmatched: [], mismatch: [] }), { msg: 'PW synced: 58 lectures done', warn: '' });
assert.strictEqual(pwToast({ ticked: 1, unmatched: ['X'], mismatch: ['a', 'b'] }).warn, 'unmatched: X · 2 chapter mismatches');
console.log('all pwsync tests passed');

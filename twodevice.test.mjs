// Extension snapshot -> Windows import -> Supabase merge -> phone, and back. Uses the real merge code from sync-core.js and io.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SUBJECTS, TESTS } from './data.js';
import { SYNCED, hash, mergeKey } from './sync-core.js';
import { applyPwSync, parsePwText, pwIsNewer } from './io.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const snap = parsePwText(fs.readFileSync(new URL('./fixtures/pw-sync-sample.json', import.meta.url), 'utf8'));
assert.ok(snap, 'fixture parses as a pw-sync file');

let clock = 1000; const server = {};
const device = (name) => ({ name, st: { subjects: clone(SUBJECTS), tests: clone(TESTS), mocks: [] }, meta: { keys: {}, init: false } });
const push = (d) => SYNCED.forEach((k) => {                         // same rule as detect() + push() in sync.jsx
  if (d.st[k] === undefined) return;
  const h = hash(d.st[k]), e = d.meta.keys[k];
  if (!e || e.h !== h) d.meta.keys[k] = { h, t: ++clock, dirty: true };
  if (d.meta.keys[k].dirty) { server[k] = { v: clone(d.st[k]), t: d.meta.keys[k].t }; d.meta.keys[k].dirty = false; }
});
const pull = (d) => {                                               // same rule as pull() in sync.jsx
  if (!d.meta.init) SYNCED.forEach((k) => { d.meta.keys[k] = server[k] ? { h: hash(d.st[k]), t: 0, dirty: false } : { h: '', t: 0, dirty: false }; });
  for (const k of Object.keys(server)) {
    const res = mergeKey(k, d.st[k], d.meta.keys[k], clone(server[k]));
    if (!res) continue;
    if (hash(res.v) !== hash(d.st[k])) d.st[k] = res.v;
    d.meta.keys[k] = { h: hash(res.v), t: res.t, dirty: res.dirty || !!d.meta.keys[k]?.dirty };
  }
  d.meta.init = true;
};
const lecs = (st) => st.subjects.flatMap((s) => s.chapters.flatMap((c) => c.lectures));
const apply = (d, sn) => { const r = applyPwSync(d.st, sn); Object.assign(d.st, { subjects: r.subjects, tests: r.tests, mocks: r.mocks, pwSync: r.pwSync }); return r.report; };

const win = device('windows'), phone = device('phone');

// 1. extension file reaches Windows
const rep = apply(win, snap);
assert.equal(rep.ticked, 12); assert.equal(rep.newTests, 7); assert.equal(rep.newResults, 1);
const winDone = lecs(win.st).filter((l) => l.done).length, winTests = win.st.tests.length;
push(win); pull(win);

// 2. phone, first sync, gets everything the extension found
pull(phone);
assert.equal(lecs(phone.st).filter((l) => l.done).length, winDone, 'ticks reach the phone');
assert.ok(lecs(phone.st).some((l) => l.pw === 'done' && l.dur > 0), 'pw state and duration reach the phone');
assert.equal(phone.st.tests.length, winTests, 'tests reach the phone, no duplicates');
assert.equal(phone.st.mocks.length, 1); assert.equal(phone.st.mocks[0].score, 2.71);
assert.equal(phone.st.pwSync.totals.lectures, snap.totals.lectures);

// 3. phone ticks one more lecture and tags the result's errors
const extra = lecs(phone.st).find((l) => !l.done && !l.pw); extra.done = true;
phone.st.mocks = phone.st.mocks.map((m) => ({ ...m, concept: 5, calc: 2, time: 1, silly: 1 }));
push(phone); pull(win);
assert.ok(lecs(win.st).filter((l) => l.done).length >= winDone + 1, 'phone tick reaches Windows');
assert.equal(win.st.mocks[0].concept, 5, 'phone error tags reach Windows');

// 4. extension syncs again (newer file): nothing the phone added is lost, nothing duplicates
const snap2 = { ...snap, updated: new Date(Date.parse(snap.updated) + 3600e3).toISOString() };
assert.ok(pwIsNewer(snap2, win.st.pwSync)); assert.ok(!pwIsNewer(snap, win.st.pwSync), 'an older/equal file is ignored');
const rep2 = apply(win, snap2);
assert.equal(rep2.newTests, 0); assert.equal(win.st.tests.length, winTests);
assert.equal(win.st.mocks.length, 1); assert.equal(win.st.mocks[0].concept, 5);
assert.ok(lecs(win.st).filter((l) => l.done).length >= winDone + 1, 'manual ticks survive a re-sync');
push(win); pull(phone);
assert.equal(phone.st.mocks.length, 1); assert.equal(phone.st.tests.length, winTests);
assert.equal(lecs(phone.st).filter((l) => l.done).length, lecs(win.st).filter((l) => l.done).length, 'both devices agree');
console.log('two-device sync tests passed');

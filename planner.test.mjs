import assert from 'node:assert';
import { buildPlan, lectureDate, workDays, addDays, diffDays, planCfg, PLAN_DEF, calcPace, mastery, shrink, weightsFor, masteryLabel } from './planner.js';

// dates
assert.strictEqual(lectureDate('5 Oct', '2026-10-04'), '2026-10-05');
assert.strictEqual(lectureDate('3 Jan', '2026-12-20'), '2027-01-03');
assert.strictEqual(lectureDate('28 Dec', '2027-01-02'), '2026-12-28');
assert.strictEqual(lectureDate('-', '2026-10-04'), null);
assert.strictEqual(lectureDate('—', '2026-10-04'), null);
assert.strictEqual(addDays('2026-12-31', 1), '2027-01-01');
assert.strictEqual(diffDays('2026-12-31', '2026-10-04'), 88);
assert.strictEqual(workDays('2026-10-04', '2026-10-10', -1), 7);
assert.strictEqual(workDays('2026-10-04', '2026-10-10', 0), 6);   // 4 Oct 2026 is a Sunday
assert.strictEqual(planCfg({ capH: 5 }).hPerLecture, PLAN_DEF.hPerLecture);

// fixtures
const lec = (n, o = {}) => Array.from({ length: n }, (_, i) => ({ name: `Lecture ${i + 1}`, done: false, ...(o.date ? { date: o.date[i] } : {}), ...(o.done && i < o.done ? { done: true } : {}) }));
const sub = (id, row, type, chs) => ({ id, name: id.toUpperCase(), row, type, chapters: chs });
const rows = [
  { id: 'os', name: 'OS', marks: 10, group: 'core' }, { id: 'cn', name: 'CN', marks: 10, group: 'core' },
  { id: 'ga', name: 'GA', marks: 15, group: 'ga' }, { id: 'linalg', name: 'Linear', marks: 5, group: 'ma' },
  { id: 'prog', name: 'Prog', marks: 10, group: 'core' },
];
const base = {
  today: '2026-10-04', targetDate: '2026-10-14', examDate: '2026-10-30', goalH: 6, tests: [], mocks: [], revDue: [], log: {}, rows,
  sched: {}, mastery: {}, urgent: {}, plan: { hPerLecture: 2, revPct: 0, bufferPct: 0, restDay: -1, capH: 9 }, neglectDays: 5,
  goalMin: { ga: 60, ma: 60, core: 180 }, pyq: { count: 0, goal: 10 },
};

// verdict: 20 h over 11 days, nothing logged -> amber (feasible, but no recent study to prove it)
let subjects = [sub('cn', 'cn', 'rec', [{ name: 'Ch1', lectures: lec(10) }])];
let P = buildPlan({ ...base, subjects });
assert.strictEqual(P.horizon.remainingHours, 20); assert.strictEqual(P.horizon.workDays, 11);
assert.strictEqual(P.horizon.needPerDay, 1.8); assert.strictEqual(P.horizon.status, 'amber');
// same, but 7 days of 3 h logged -> green
const log = {}; for (let i = 1; i <= 7; i++) log[addDays('2026-10-04', -i)] = { cn: 3 * 3600 };
P = buildPlan({ ...base, subjects, log }); assert.strictEqual(P.horizon.status, 'green'); assert.strictEqual(P.horizon.actual7, 3);
// red: far more work than goalH allows -> the only option is to study more; nothing proposes cutting scope or moving the date
subjects = [sub('cn', 'cn', 'rec', [{ name: 'Ch1', lectures: lec(60) }]), sub('os', 'os', 'rec', [{ name: 'Ch1', lectures: lec(10) }])];
P = buildPlan({ ...base, subjects });
assert.strictEqual(P.horizon.status, 'red');
assert.deepStrictEqual(P.horizon.options.map((o) => o.kind), ['raise']);
// a stale plan.skip from v10 no longer removes any hours
const before = P.horizon.remainingHours;
P = buildPlan({ ...base, subjects, plan: { ...base.plan, skip: { cn: true } } });
assert.strictEqual(P.horizon.remainingHours, before);
// real lecture durations (PW sync) are reported as video hours; ticked lectures and lectures without a length are not counted
subjects = [sub('os', 'os', 'rec', [{ name: 'Ch1', lectures: [{ name: 'a', date: '-', dur: 3600 }, { name: 'b', date: '-', dur: 7200, done: true }, { name: 'c', date: '-' }] }])];
P = buildPlan({ ...base, subjects });
// unknown length falls back to the average known length (here (3600+7200)/2 = 1.5 h), flagged as estimated
assert.strictEqual(P.horizon.videoHours, 2.5); assert.strictEqual(P.horizon.videoEstimated, true);
subjects = [sub('os', 'os', 'rec', [{ name: 'Ch1', lectures: [{ name: 'a', date: '-', dur: 3600 }, { name: 'b', date: '-', dur: 7200, done: true }] }])];
P = buildPlan({ ...base, subjects }); assert.strictEqual(P.horizon.videoHours, 1); assert.strictEqual(P.horizon.videoEstimated, false);
// no durations anywhere: default 1.5 h per lecture so the speed control still changes the result
subjects = [sub('os', 'os', 'rec', [{ name: 'Ch1', lectures: [{ name: 'a', date: '-' }, { name: 'b', date: '-' }] }])];
P = buildPlan({ ...base, subjects }); assert.strictEqual(P.horizon.videoHours, 3);
// placeholder chapter counts as `plc` lectures; ticking it removes that work
subjects = [sub('ds', 'cn', 'live', [{ name: 'Trees', lectures: [{ name: 'Lectures done', date: '-', done: false }] }])];
P = buildPlan({ ...base, subjects, plan: { ...base.plan, plc: 4 } }); assert.strictEqual(P.horizon.remainingLectures, 4);
subjects[0].chapters[0].lectures[0].done = true;
P = buildPlan({ ...base, subjects }); assert.strictEqual(P.horizon.remainingLectures, 0); assert.strictEqual(P.horizon.status, 'green');
// measured pace replaces the default after 5 finished lectures
subjects = [sub('cn', 'cn', 'rec', [{ name: 'Ch1', lectures: lec(20, { done: 5 }) }])];
const l2 = { '2026-09-20': { cn: 5 * 3600 } };   // 1 h per lecture
P = buildPlan({ ...base, subjects, log: l2 }); assert.strictEqual(P.horizon.remainingHours, 15); assert.strictEqual(P.horizon.pace, 1);
// target date passed with work left -> red, no division by zero
P = buildPlan({ ...base, subjects, targetDate: '2026-10-01' }); assert.strictEqual(P.horizon.status, 'red'); assert.strictEqual(P.horizon.needPerDay, null);

// Today list: fixed items first, then revisions, catch-up, template, PYQs; do-now is the first undone item
subjects = [
  sub('os', 'os', 'live', [{ name: 'Process', lectures: [{ name: 'Lecture 1', date: '2 Oct', done: false }, { name: 'Lecture 2', date: '4 Oct', done: false }, { name: 'Lecture 3', date: '9 Oct', done: false }] }]),
  sub('cn', 'cn', 'rec', [{ name: 'Intro', lectures: lec(3) }]),
  sub('ga', 'ga', 'live', [{ name: 'Quant', lectures: [{ name: 'Lecture 1', date: '1 Oct', done: true }] }]),
  sub('la', 'linalg', 'rec', [{ name: 'Det', lectures: lec(2) }]),
];
const tests = [{ id: 't1', name: 'DBMS WT3', kind: 'weekly', date: '2026-10-04', time: '19:00', mins: 35 }, { id: 't2', name: 'Old', kind: 'weekly', date: '2026-09-01', mins: 30 }];
P = buildPlan({ ...base, subjects, tests, revDue: [{ sub: 'OS', ch: 'Basics', i: 0, late: 2 }] });
const ks = P.today.items.map((i) => i.kind);
assert.deepStrictEqual(ks.slice(0, 4), ['test', 'live', 'revision', 'catchup']);
assert.ok(ks.includes('ga') && ks.includes('ma') && ks.includes('pyq'));
assert.strictEqual(P.doNow.kind, 'test');
assert.ok(P.today.items.find((i) => i.kind === 'catchup').label.includes('Lecture 1'));
assert.ok(P.today.items.find((i) => i.kind === 'ma').label.includes('Det'));            // next recorded unit for the maths block
assert.ok(!P.today.items.some((i) => i.kind === 'core' && i.label.startsWith('OS')));   // OS already has a live lecture today
// logging the test removes it from today
P = buildPlan({ ...base, subjects, tests, mocks: [{ test: 't1', date: '2026-10-04' }] }); assert.ok(!P.today.items.some((i) => i.kind === 'test'));
// the daily cap pushes the overflow out of the list instead of making it longer
P = buildPlan({ ...base, subjects, tests, plan: { ...base.plan, capH: 1 } }); assert.ok(P.today.over.length > 0);
assert.ok(P.today.items.some((i) => !i.done));
// finished template blocks are marked done
P = buildPlan({ ...base, subjects, log: { '2026-10-04': { ga: 3600 } } }); assert.ok(P.today.items.find((i) => i.kind === 'ga').done);
P = buildPlan({ ...base, subjects, pyq: { count: 10, goal: 10 } }); assert.ok(P.today.items.find((i) => i.kind === 'pyq').done);

// Week: 2026-10-04 is a Sunday, so the week is Mon 28 Sep .. Sun 4 Oct
P = buildPlan({ ...base, subjects, tests });
assert.strictEqual(P.week.from, '2026-09-28'); assert.strictEqual(P.week.to, '2026-10-04');
assert.ok(P.week.items.some((i) => i.key === 'wl:os' && i.detail.includes('missed')));
assert.ok(P.week.items.some((i) => i.key === 'wmock'));                                   // no full test scheduled or logged
assert.ok(P.week.items.some((i) => i.key === 'wrec'));
// Month + exam
assert.strictEqual(P.month.from, '2026-10-01'); assert.strictEqual(P.month.to, '2026-10-31');
assert.strictEqual(P.exam.daysLeft, 26); assert.strictEqual(P.exam.revisionDays, 16);
const ft = [{ id: 'g1', name: 'GBG 1', kind: 'gbg', date: '2026-10-18', mins: 180 }, { id: 'g2', name: 'GBG 2', kind: 'gbg', date: '2026-10-25', mins: 180 }];
P = buildPlan({ ...base, subjects, tests: ft, mocks: [{ test: 'g1', date: '2026-10-18' }] });
assert.strictEqual(P.exam.testsTotal, 2); assert.strictEqual(P.exam.testsDone, 1); assert.deepStrictEqual(P.exam.next.map((t) => t.name), ['GBG 2']);
// a marks row with no lectures (e.g. Digital Logic) is ignored, not flagged as behind
P = buildPlan({ ...base, rows: [...rows, { id: 'digital', name: 'Digital', marks: 5, group: 'core' }], subjects });
assert.ok(!P.week.items.some((i) => i.key === 'wb:digital' || i.key === 'wn:digital'));
// mastery (moved here from readiness-core.js; same assertions)
{
  const near = (a, b, e = 0.06) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
  const w = { cov: 40, pyq: 30, rev: 30 };
  near(shrink(1, 100), 66.67); near(shrink(4, 100), 83.33); assert.strictEqual(shrink(0, 0), null); near(shrink(1, 100, 40), 60);
  const a = weightsFor(w, false); near(a.cov, 40 / 70, 1e-9); near(a.pyq, 30 / 70, 1e-9); assert.strictEqual(a.test, 0);
  const b = weightsFor(w, true); near(b.cov + b.pyq + b.test, 1, 1e-9);
  near(mastery({ C: 100, P: 100, w }).M, 100);
  assert.ok(mastery({ C: 0, P: 0, tests: [100], w }).M < 25);
  assert.strictEqual(masteryLabel(85), 'Strong'); assert.strictEqual(masteryLabel(84.9), 'Medium'); assert.strictEqual(masteryLabel(49.9), 'Weak');
}
// calcPace: speed only shrinks the video part
{
  const c = { total: 100, video: 60, hPerDay: 5, today: '2026-10-05', targetDate: '2026-12-31', restDay: -1, bufferPct: 0, windowDays: 10 };
  const a = calcPace({ ...c, speed: 1 }), b = calcPace({ ...c, speed: 2 }), r = calcPace({ ...c, speed: 1.5 });
  assert.strictEqual(a.hours, 100); assert.strictEqual(b.hours, 70); assert.strictEqual(r.hours, 80);
  assert.strictEqual(a.finish, '2026-10-24'); assert.strictEqual(b.finish, '2026-10-18');           // 20 and 14 study days at 5 h
  assert.strictEqual(a.daysEarly, diffDays('2026-12-31', '2026-10-24')); assert.ok(b.daysEarly > a.daysEarly);
  assert.strictEqual(a.windowHours, 50);                                                             // 10 days x 5 h
  const days = diffDays('2026-12-31', '2026-10-05') + 1; assert.strictEqual(a.neededPerDay, Math.round(100 / days * 10) / 10);
  // buffer lowers effective hours per day; late finish gives negative daysEarly; 0 h/day has no finish date
  assert.ok(calcPace({ ...c, speed: 1, bufferPct: 20 }).finish > a.finish);
  assert.ok(calcPace({ ...c, speed: 1, hPerDay: 0.5 }).daysEarly < 0);
  assert.strictEqual(calcPace({ ...c, speed: 1, hPerDay: 0 }).finish, null);
  assert.strictEqual(calcPace({ ...c, total: 0, video: 0 }).finish, '2026-10-05');
  assert.strictEqual(calcPace({ ...c, video: 500, speed: 2 }).hours, 50);                            // video is capped at total
}
console.log('planner ok');

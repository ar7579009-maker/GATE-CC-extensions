import assert from 'node:assert/strict';
import { kindOf, statusOf, filterTests, countBy, resultFor } from './tests-view.js';
const T = [
  { id: 'a', name: 'Linear Algebra · Weekly Test 01', kind: 'weekly', date: '2026-09-20' },
  { id: 'pw-9', name: 'OS: TWT 02', date: '2026-10-01', source: 'pw' },
  { id: 'c', name: 'Mock Test 09', date: '2026-10-20' },
  { id: 'd', name: 'Mystery', date: '' },
];
const M = [{ id: 1, test: 'a', name: 'x', score: 2.7 }];
assert.equal(kindOf(T[1]), 'twt'); assert.equal(kindOf(T[2]), 'mock'); assert.equal(kindOf(T[3]), 'other'); assert.equal(kindOf(T[0]), 'weekly');
assert.equal(statusOf(T[0], M, '2026-10-05'), 'attempted');
assert.equal(statusOf(T[1], M, '2026-10-05'), 'missed');
assert.equal(statusOf(T[2], M, '2026-10-05'), 'upcoming');
assert.equal(statusOf(T[3], M, '2026-10-05'), 'upcoming');
assert.equal(statusOf(T[2], [{ test: 'custom', name: 'mock test 09' }], '2026-10-05'), 'attempted');   // name match
assert.deepEqual(filterTests(T, M, '2026-10-05', { status: 'missed' }).map((r) => r.t.id), ['pw-9']);
assert.deepEqual(filterTests(T, M, '2026-10-05', { kind: 'mock' }).map((r) => r.t.id), ['c']);
assert.deepEqual(filterTests(T, M, '2026-10-05').map((r) => r.t.id), ['a', 'pw-9', 'c', 'd']);
assert.deepEqual(countBy(T, M, '2026-10-05'), { attempted: 1, missed: 1, upcoming: 2 });
assert.equal(resultFor(T[0], M).score, 2.7); assert.equal(resultFor(T[1], M), null);
console.log('all tests-view tests passed');

import assert from 'node:assert';
import { logOp, sumLogs, mergeDone, mergeKey, hash } from './sync-core.js';

// log: PC and phone both study OS on the same day -> totals add up, nothing lost
const pc = { '2026-10-02': { os: 3600 } }, phone = { '2026-10-02': { os: 1800, toc: 600 } };
assert.deepStrictEqual(sumLogs([pc, phone]), { '2026-10-02': { os: 5400, toc: 600 } });
// local = mine + other; after other changes, local is recomputed without touching mine
const other0 = phone, other1 = { '2026-10-02': { os: 2400, toc: 600 } };
const local = logOp(pc, other0, 1);
assert.deepStrictEqual(logOp(logOp(local, other0, -1), other1, 1), { '2026-10-02': { os: 6000, toc: 600 } });
assert.deepStrictEqual(logOp(local, other0, -1), pc);

// ticks: union of done
const S = (a, b) => [{ id: 'os', name: 'OS', chapters: [{ name: 'CPU', lectures: [{ name: 'L1', done: a }, { name: 'L2', done: b }] }] }];
const m = mergeDone(S(true, false), S(false, true), true);
assert.deepStrictEqual(m[0].chapters[0].lectures.map((l) => l.done), [true, true]);

// mocks: union by id, no mock lost
const r = mergeKey('mocks', [{ id: 'a', date: '2026-10-01' }], { t: 5 }, { v: [{ id: 'b', date: '2026-10-02' }], t: 9 });
assert.deepStrictEqual(r.v.map((x) => x.id), ['a', 'b']); assert.ok(r.dirty);

// LWW for plain keys
assert.strictEqual(mergeKey('goalH', 6, { t: 10 }, { v: 8, t: 5 }), null);
assert.deepStrictEqual(mergeKey('goalH', 6, { t: 10 }, { v: 8, t: 20 }), { v: 8, t: 20, dirty: false });
assert.strictEqual(hash({ a: 1 }), hash({ a: 1 }));
console.log('all sync-core tests passed');

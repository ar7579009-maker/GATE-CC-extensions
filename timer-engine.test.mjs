import assert from 'node:assert';
import { tSeg, settleAt, splitByDay, commit, uncommit, boot, jWrite, jRead } from './timer-engine.js';
import { mergeSessions, saveResilient, loadResilient } from './sync-core.js';
const dkey = (d) => new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const T0 = new Date(2026, 9, 3, 18, 0, 0).getTime(), MIN = 6e4;
const run = { sub: 'os', ts: T0, runAt: T0, acc: 0, carry: 0, mode: 'free' };
// 1. locked 40 min: JS frozen, no ticks, elapsed is still exact
assert.strictEqual(tSeg(run, T0 + 40 * MIN), 2400);
// 2. pause/resume accumulate correctly
const p = settleAt(run, T0 + 10 * MIN), r2 = { ...p, runAt: T0 + 20 * MIN };
assert.strictEqual(tSeg(r2, T0 + 35 * MIN), 600 + 900);
// 2b. settleAt an EARLIER moment than the timer's own hb must give that moment's elapsed time (bug found in testing)
assert.strictEqual(settleAt({ ...run, hb: T0 + 90 * MIN }, T0 + 5 * MIN).acc, 300);
// 3. clock moved back 1 h: never negative, holds at last heartbeat
assert.strictEqual(tSeg({ ...run, hb: T0 + 30 * MIN }, T0 - 60 * MIN), 1800);
// 4. midnight split 23:30 to 00:45 = 75 min => 30 + 45
const s = new Date(2026, 9, 3, 23, 30).getTime(), e = new Date(2026, 9, 4, 0, 45).getTime();
const parts = splitByDay(s, e, 4500, dkey);
assert.deepStrictEqual(parts.map((x) => [x.day, Math.round(x.secs)]), [['2026-10-03', 1800], ['2026-10-04', 2700]]);
const after = commit({ log: {}, sessions: [] }, { sub: 'os', ts: s, mode: 'free' }, 4500, e, 'a1', dkey);
assert.strictEqual(Math.round(after.log['2026-10-04'].os), 2700);
assert.deepStrictEqual(uncommit(after, 'a1', dkey).log, {});            // undo removes from BOTH days
assert.strictEqual(commit({ log: {} }, { sub: 'os', ts: s, mode: 'free' }, 30, e, 'x', dkey).log && Object.keys(commit({ log: {} }, { sub: 'os', ts: s, mode: 'free' }, 30, e, 'x', dkey).log).length, 0);
// 5. cold boot: short gap = silent, long gap = ask, journal beats a stale main blob
assert.strictEqual(boot(run, { t: run, hb: T0 + 59 * MIN }, T0 + 60 * MIN).ask, null);
const b = boot({ ...run }, { t: run, hb: T0 + 5 * MIN }, T0 + 200 * MIN);
assert.ok(b.ask && b.ask.last === T0 + 5 * MIN && b.src === 'journal');
assert.ok(boot({ ...run, runAt: T0 }, null, T0 + 13 * 3600e3).ask.long);   // forgot to stop: 13 h
// 6. journal + corrupt-state fallback
const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, removeItem: (k) => { delete m[k]; }, m }; };
const st = mem(); jWrite(st, run, 123); assert.strictEqual(jRead(st).hb, 123);
saveResilient(st, 'k', { a: 1 }, 1e12); saveResilient(st, 'k', { a: 2 }, 1e12 + 1); st.setItem('k', '{"a":2,'); // truncated write
assert.deepStrictEqual(loadResilient(st, 'k'), { v: { a: 1 }, from: 'k:bak' });
st.setItem('k:bak', 'garbage'); assert.strictEqual(loadResilient(st, 'k').v, null); assert.ok(st.getItem('k:corrupt'));
// 7. sessions merge
assert.deepStrictEqual(mergeSessions([{ id: 'a', start: 2, u: 1, note: 'old' }], [{ id: 'a', start: 2, u: 5, note: 'new' }, { id: 'b', start: 1 }]).map((x) => x.note || x.id), ['b', 'new']);
console.log('all timer-engine tests passed');

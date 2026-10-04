import assert from 'node:assert';
import { mastery, shrink, weightsFor, label } from './readiness-core.js';
const near = (a, b, e = 0.06) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const w = { cov: 40, pyq: 30, rev: 30 };
near(shrink(1, 100), 66.67); near(shrink(4, 100), 83.33);                 // spec examples
assert.strictEqual(shrink(0, 0), null);
near(shrink(1, 100, 40), 60);                                              // adjustable prior
const a = weightsFor(w, false); near(a.cov, 40 / 70, 1e-9); near(a.pyq, 30 / 70, 1e-9); assert.strictEqual(a.test, 0);
const b = weightsFor(w, true); near(b.cov + b.pyq + b.test, 1, 1e-9);
// no test data is NOT a penalty: 100% coverage + 100% PYQ = 100
near(mastery({ C: 100, P: 100, w }).M, 100);
// one perfect test with zero coverage/PYQ must not look strong
assert.ok(mastery({ C: 0, P: 0, tests: [100], w }).M < 25);
// inactivity never lowers a score
near(mastery({ C: 100, P: 100, w }).M, 100);
assert.strictEqual(label(85), 'Strong'); assert.strictEqual(label(84.9), 'Medium'); assert.strictEqual(label(49.9), 'Weak');
console.log('readiness-core ok');

import assert from 'node:assert/strict';
import { CARDS, cleanLayout, isHidden, hideCard, restoreCard, hiddenList, isLocked } from './layout.js';
assert.deepEqual(cleanLayout(undefined), { hidden: [] });
assert.deepEqual(cleanLayout({ hidden: 'x' }), { hidden: [] });
let l = hideCard({ hidden: [] }, 'calc');
assert.ok(isHidden(l, 'calc') && !isHidden(l, 'timer'));
assert.deepEqual(hideCard(l, 'calc').hidden, ['calc']);                 // no duplicates
assert.deepEqual(hideCard(l, 'verdict').hidden, ['calc']);              // locked can't hide
assert.deepEqual(hideCard(l, 'nope').hidden, ['calc']);                 // unknown ignored
assert.deepEqual(cleanLayout({ hidden: ['today', 'verdict', 'zzz', 'timer'] }).hidden, ['timer']);
assert.ok(!isHidden({ hidden: ['verdict'] }, 'verdict') && isLocked('today'));
assert.deepEqual(hiddenList(hideCard(l, 'timer')), [{ id: 'calc', name: CARDS.calc }, { id: 'timer', name: CARDS.timer }]);
assert.deepEqual(restoreCard(hideCard(l, 'timer'), 'calc').hidden, ['timer']);
console.log('all layout tests passed');

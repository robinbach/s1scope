import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Row } from '../src/format.ts';
import { brier, confusion, ece, featureOf, reliability, sweep, usualThreshold } from '../src/stats.ts';

const pts = [
  { p: 0.9, y: true },
  { p: 0.8, y: false },
  { p: 0.3, y: true },
  { p: 0.1, y: false },
];

test('confusion at a threshold', () => {
  const c = confusion(pts, 0.5);
  assert.deepEqual([c.tp, c.fp, c.fn, c.tn], [1, 1, 1, 1]);
  assert.equal(c.precision, 0.5);
  assert.equal(c.coverage, 0.5);
  // p equal to the threshold counts as accepted.
  assert.equal(confusion([{ p: 0.5, y: true }], 0.5).tp, 1);
});

test('reliability bins, ECE and Brier', () => {
  const bins = reliability(pts, 10);
  assert.equal(bins.length, 4);
  assert.deepEqual(bins.map((b) => b.n), [1, 1, 1, 1]);
  const perfect = [
    { p: 1, y: true },
    { p: 0, y: false },
  ];
  assert.equal(ece(perfect), 0);
  assert.equal(brier(perfect), 0);
  assert.equal(brier([{ p: 0.5, y: true }]), 0.25);
  assert.equal(ece([]), undefined);
});

test('sweep covers 0..1', () => {
  const s = sweep(pts);
  assert.equal(s.length, 101);
  assert.equal(s[0].t, 0);
  assert.equal(s.at(-1)!.t, 1);
  assert.equal(s[0].fp, 2);
  assert.equal(s.at(-1)!.fn, 2);
});

test('usual threshold and features', () => {
  const row = (threshold?: number): Row => ({ id: 'x', run: 'r', question: 'q', type: 'noul', p: 0.5, threshold, tags: { lang: 'en' } });
  assert.equal(usualThreshold([row(0.3), row(0.6), row(0.6)]), 0.6);
  assert.equal(usualThreshold([row()]), undefined);
  assert.equal(featureOf(row(), 'tag:lang'), 'en');
  assert.equal(featureOf(row(), 'tag:missing'), '(none)');
  assert.equal(featureOf(row(), 'model'), '(none)');
});

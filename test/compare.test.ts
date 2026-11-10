import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compare } from '../src/compare.ts';
import type { Row } from '../src/format.ts';

const row = (run: string, item: string | undefined, p: number, y?: boolean): Row => ({
  id: `${run}/${item}/${p}`,
  run,
  item,
  question: 'q',
  type: 'noul',
  p,
  y,
  tags: {},
});

test('compare lines up samples, averages repeats and finds flips', () => {
  const rows = [
    row('old', 'i1', 0.9, true), // right in old
    row('new', 'i1', 0.2, true), // wrong in new → worse
    row('old', 'i2', 0.7, false), // wrong in old
    row('new', 'i2', 0.1, false), // right in new → better
    row('new', 'i2', 0.3, false), // repeat, averaged
    row('old', 'i3', 0.4), // no label
    row('new', 'i3', 0.6),
    row('old', 'i4', 0.5, true), // only in old
    row('new', undefined, 0.5, true), // no item
  ];
  const c = compare(rows, 'run', 'old', 'new', 0.5);
  assert.equal(c.pairs.length, 3);
  assert.equal(c.onlyA, 1);
  assert.equal(c.onlyB, 0);
  assert.equal(c.noItem, 1);
  const by = Object.fromEntries(c.pairs.map((p) => [p.item, p]));
  assert.equal(by.i1.change, 'worse');
  assert.equal(by.i2.change, 'better');
  assert.equal(by.i2.b.rows.length, 2);
  assert.ok(Math.abs(by.i2.b.p - 0.2) < 1e-9);
  assert.equal(by.i3.change, 'unlabeled');
  assert.ok(Math.abs(by.i3.dp - 0.2) < 1e-9);
});

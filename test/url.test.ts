import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeRuns, emptyView, formatView, parseView, selectRuns, type ViewState } from '../web/url.ts';

const plain = (x: unknown) => JSON.parse(JSON.stringify(x));

test('a view survives formatting and parsing', () => {
  const v: ViewState = {
    ...emptyView(),
    q: 'where',
    f: '/^c\\d+$/',
    pool: true,
    runs: '/0\\.1\\.1 2026-11-11T01-35/',
    view: 'compare',
    by: 'tag:variant',
    a: 'v0',
    b: 'v1 & more',
    t: 0.6,
    split: 'tag:lang',
    tab: 'worse',
    open: 'run a/item 1:3',
  };
  assert.deepEqual(plain(parseView(`#${formatView(v)}`)), plain(v));
  const listed: ViewState = { ...emptyView(), run: ['a b', 'c+d'], norun: [] };
  assert.deepEqual(plain(parseView(formatView(listed))), plain(listed));
  assert.equal(formatView(emptyView()), '');
  assert.match(formatView({ ...emptyView(), by: 'tag:variant' }), /by=tag:variant/);
});

test('parseView ignores values it cannot use', () => {
  const v = parseView('#view=sideways&t=1.5&pool=yes');
  assert.equal(v.view, 'overview');
  assert.equal(v.t, undefined);
  assert.equal(v.pool, false);
});

test('selectRuns applies filters and names, and reports what is missing', () => {
  const names = ['eval 2026-11-10 v0', 'eval 2026-11-11 v0', 'eval 2026-11-11 v1', 'playtest x'];
  const sorted = (s: Set<string>) => [...s].sort();
  assert.equal(selectRuns({ run: [], norun: [] }, names).runs.size, 4);
  assert.deepEqual(sorted(selectRuns({ runs: '2026-11-11', run: [], norun: [] }, names).runs), names.slice(1, 3));
  assert.deepEqual(sorted(selectRuns({ runs: '/v\\d$/', run: [], norun: ['eval 2026-11-10 v0'] }, names).runs), names.slice(1, 3));
  const named = selectRuns({ run: ['playtest x', 'gone'], norun: [] }, names);
  assert.deepEqual(sorted(named.runs), ['playtest x']);
  assert.deepEqual(named.missing, ['1 of 2 named runs not loaded']);
  assert.deepEqual(selectRuns({ runs: 'nothing', run: [], norun: [] }, names).missing, ['run filter nothing matched no run']);
});

test('describeRuns writes the shortest parameters that give the selection back', () => {
  const names = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(describeRuns(new Set(names), names), { run: [], norun: [] });
  assert.deepEqual(describeRuns(new Set(['a', 'b', 'c', 'd']), names), { run: [], norun: ['e'] });
  assert.deepEqual(describeRuns(new Set(['b']), names), { run: ['b'], norun: [] });
  assert.deepEqual(describeRuns(new Set(['a', 'b']), names, '/^[ab]$/'), { runs: '/^[ab]$/', run: [], norun: [] });
  // The filter no longer gives this selection: fall back to names.
  assert.deepEqual(describeRuns(new Set(['a']), names, '/^[ab]$/'), { run: ['a'], norun: [] });
  for (const pick of [['a'], ['a', 'c', 'e'], ['b', 'c', 'd', 'e']]) {
    const d = describeRuns(new Set(pick), names);
    assert.deepEqual([...selectRuns(d, names).runs].sort(), pick);
  }
});

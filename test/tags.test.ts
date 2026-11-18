import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Row } from '../src/format.ts';
import { facet, filterKeys, filterRows, formatFilters, parseFilters, toggleValue, type FilterGroup } from '../web/tags.ts';
import { emptyView, formatView, parseView } from '../web/url.ts';

const row = (id: string, model: string, tags: Row['tags'], qv?: string): Row => ({
  id,
  run: 'r',
  item: id,
  question: 'q',
  type: 'noul',
  p: 0.5,
  model,
  qv,
  tags,
});
const rows = [
  row('a', 'm1', { variant: 'v0', lang: 'en' }, 'x1'),
  row('b', 'm1', { variant: 'v1', lang: 'en' }),
  row('c', 'm2', { variant: 'v1', lang: 'zh' }),
  row('d', 'm2', { variant: 'v2', lang: 'zh', rep: 1 }),
  row('e', 'm2', { lang: 'en' }),
];
const ids = (rs: Row[]) => rs.map((r) => r.id).join('');

test('the features to filter by are the split features and every tag', () => {
  assert.deepEqual(filterKeys(rows), ['model', 'backend', 'version', 'tag:lang', 'tag:rep', 'tag:variant']);
  assert.deepEqual(filterKeys([...rows, { ...rows[0], question: 'other' }]).slice(0, 4), ['model', 'backend', 'version', 'question']);
});

test('values of one feature are alternatives, features narrow each other', () => {
  assert.equal(ids(filterRows(rows, [{ key: 'tag:variant' }])), 'abcde');
  assert.equal(ids(filterRows(rows, [{ key: 'tag:variant', values: ['v0', 'v1'] }])), 'abc');
  assert.equal(ids(filterRows(rows, [{ key: 'tag:variant', values: ['v1', '(none)'] }, { key: 'model', values: ['m2'] }])), 'ce');
  assert.equal(ids(filterRows(rows, [{ key: 'tag:variant', values: [] }])), '');
  // Numbers and booleans compare as text.
  assert.equal(ids(filterRows(rows, [{ key: 'tag:rep', values: ['1'] }])), 'd');
  assert.equal(ids(filterRows(rows, [{ key: 'version', values: ['x1'] }])), 'a');
});

test('a facet counts after the other filters and keeps every value', () => {
  const groups: FilterGroup[] = [{ key: 'tag:variant', values: ['v1'] }, { key: 'model', values: ['m2'] }];
  assert.deepEqual(facet(rows, groups, 'tag:variant'), [['(none)', 1], ['v0', 0], ['v1', 1], ['v2', 1]]);
  assert.deepEqual(facet(rows, groups, 'model'), [['m1', 1], ['m2', 1]]);
});

test('ticking every value again lifts the restriction', () => {
  const all = ['v0', 'v1', 'v2'];
  const off = toggleValue({ key: 'tag:variant' }, all, 'v1', false);
  assert.deepEqual(off, { key: 'tag:variant', values: ['v0', 'v2'] });
  assert.deepEqual(toggleValue(off, all, 'v1', true), { key: 'tag:variant', values: undefined });
});

test('filters survive the address', () => {
  const groups: FilterGroup[] = [{ key: 'model' }, { key: 'tag:variant', values: ['v0', 'a=b'] }, { key: 'tag:rep', values: [] }];
  assert.deepEqual(parseFilters(formatFilters(groups)), groups);
  const v = { ...emptyView(), q: 'where', filters: groups };
  const plain = (x: unknown) => JSON.parse(JSON.stringify(x));
  assert.deepEqual(plain(parseView(`#${formatView(v)}`)), plain(v));
  assert.match(formatView(v), /filter=model&filter=tag:variant=v0&filter=tag:variant=a=b&filter=tag:rep=$/);
  assert.deepEqual(parseView('#').filters, []);
});

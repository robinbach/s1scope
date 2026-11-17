import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { check, formatReport } from '../src/check.ts';

const line = (x: unknown) => JSON.stringify(x);

test('check passes a clean log and summarizes it per run', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 's1scope-'));
  await writeFile(
    path.join(dir, 'run.jsonl'),
    [
      line({ v: 0, run: 'r1', item: 'a', answers: { q: { type: 'noul', p: 0.9 } } }),
      line({ v: 0, run: 'r1', item: 'b', response: { answers: { q: { type: 'noul', noul: 0.1 } } } }),
      line({ item: 'a', question: 'q', expected: true }),
    ].join('\n') + '\n',
  );
  const r = await check([dir]);
  assert.equal(r.files, 1);
  assert.equal(r.records, 2);
  assert.equal(r.answers, 2);
  assert.equal(r.labeled, 1);
  assert.deepEqual(r.runs, [{ run: 'r1', records: 2, answers: 2, labeled: 1, questions: ['q'] }]);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.match(formatReport(r), /OK$/);
});

test('check reports bad lines as errors and suspicious data as warnings', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 's1scope-'));
  await writeFile(
    path.join(dir, 'run.jsonl'),
    [
      line({ id: 'x', run: 'r', item: 'a', answers: { q: { type: 'noul', p: 1.4 } }, labels: { q: 'maybe' } }),
      line({ id: 'x', run: 'r', answers: { q: { type: 'noul', p: 0.5 } } }),
      line({ id: 'y', run: 'r', response: { answers: { q: { text: 'yes' } } } }),
      line({ run: 'r' }),
      'not json',
      line({ item: 'ghost', question: 'q', expected: false }),
    ].join('\n'),
  );
  const r = await check([dir]);
  assert.deepEqual(
    r.errors.map((e) => e.message),
    ['duplicate id x', 'neither a record (needs run + answers/response) nor a label', 'not JSON'],
  );
  const warnings = r.warnings.map((w) => `${w.where}: ${w.message}`);
  assert.ok(warnings.some((w) => w.startsWith('x: q: probability 1.4')));
  assert.ok(warnings.some((w) => w.startsWith('y: no readable answer')));
  assert.ok(warnings.some((w) => w === 'x: q: label "maybe" is not a yes/no'));
  assert.ok(warnings.some((w) => w === 'ghost / q: label for an item no record has'));
  assert.match(formatReport(r), /FAIL$/);
});

test('check fails when there are no answers', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 's1scope-'));
  await writeFile(path.join(dir, 'labels.jsonl'), line({ item: 'a', question: 'q', expected: true }) + '\n');
  const r = await check([dir]);
  assert.deepEqual(r.errors.map((e) => e.message), ['no answers found']);
});

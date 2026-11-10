import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { load } from '../src/load.ts';
import { recordingFetch } from '../src/record.ts';
import { handler } from '../src/server.ts';
import { MemoryStore } from '../src/store.ts';

test('load reads records and labels from a folder, skipping junk', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 's1scope-'));
  await writeFile(
    path.join(dir, 'a.jsonl'),
    [
      JSON.stringify({ run: 'r', item: 'i1', response: { answers: { q: { type: 'noul', noul: 0.7 } } } }),
      'not json',
      JSON.stringify({ hello: 1 }),
      '',
    ].join('\n'),
  );
  await writeFile(path.join(dir, 'labels.jsonl'), JSON.stringify({ item: 'i1', question: 'q', expected: true }) + '\n');
  await writeFile(path.join(dir, 'ignored.txt'), 'x');
  const data = await load([dir]);
  assert.equal(data.records.size, 1);
  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0].y, true);
  assert.equal(data.skipped.length, 2);
});

test('recordingFetch logs System One calls and passes others through', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 's1scope-'));
  const file = path.join(dir, 'log', 'calls.jsonl');
  const fake = (async (input: RequestInfo | URL) =>
    new Response(JSON.stringify({ model: 'jev-1.13.0', answers: { q: { type: 'noul', noul: 0.3 } } }), {
      status: 200,
      headers: { 'x-request-id': 'req_1', 'content-type': 'application/json' },
    })) as typeof fetch;
  const f = recordingFetch(fake, { file, run: 'test', tags: { split: 'dev' } });
  const body = JSON.stringify({ model: 'jev-latest', state: { text: 'hi' }, questions: { q: { type: 'noul' } } });
  const res = await f.with({ item: 'case-1', labels: { q: false } })('https://user:pw@api.example.com/v1/systemone', {
    method: 'POST',
    body,
    headers: { Authorization: 'Bearer secret' },
  });
  assert.equal((await res.json()).answers.q.noul, 0.3);
  await f('https://api.example.com/v1/other', { method: 'POST', body: '{}' });
  const lines = (await readFile(file, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  const [rec] = lines;
  assert.equal(rec.run, 'test');
  assert.equal(rec.item, 'case-1');
  assert.equal(rec.model, 'jev-latest');
  assert.equal(rec.request_id, 'req_1');
  assert.equal(rec.status, 200);
  assert.deepEqual(rec.tags, { split: 'dev' });
  assert.deepEqual(rec.labels, { q: false });
  assert.ok(!rec.endpoint.includes('pw'));
  assert.ok(!JSON.stringify(rec).includes('secret'));
});

test('server answers /api/overview, /api/rows and /api/record', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 's1scope-'));
  await writeFile(path.join(dir, 'a.jsonl'), JSON.stringify({ id: 'x1', run: 'r', answers: { q: { type: 'noul', p: 0.2 } } }) + '\n');
  const handle = handler(await MemoryStore.open([dir]));
  const server = createServer(async (req, res) => {
    if (!(await handle(req, res))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  try {
    const base = `http://127.0.0.1:${port}`;
    const overview = await (await fetch(`${base}/api/overview`)).json();
    assert.deepEqual(overview.counts, [{ run: 'r', question: 'q', type: 'noul', n: 1, labeled: 0 }]);
    const post = (body: unknown) => fetch(`${base}/api/rows`, { method: 'POST', body: JSON.stringify(body) });
    assert.equal((await (await post({ questions: ['q'] })).json()).rows.length, 1);
    assert.equal((await (await post({ questions: ['q'], runs: ['other'] })).json()).rows.length, 0);
    assert.equal((await post({ questions: 'q' })).status, 400);
    assert.equal((await fetch(`${base}/api/rows`)).status, 405);
    const record = await (await fetch(`http://127.0.0.1:${port}/api/record?id=x1`)).json();
    assert.equal(record.run, 'r');
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/record?id=nope`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/index.html`)).status, 404);
  } finally {
    server.close();
  }
});

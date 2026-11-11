import assert from 'node:assert/strict';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { Store } from '../src/api.ts';
import { DuckStore } from '../src/duckdb.ts';
import { handler } from '../src/server.ts';
import { MemoryStore } from '../src/store.ts';

const noul = (p: number) => ({ type: 'noul', noul: p });
const choice = (c: string, confidence: number) => ({ choice: c, confidence });
const lines = (...xs: unknown[]) => xs.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n') + '\n';

/** A small log that exercises every way a row gets its label. */
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 's1scope-store-'));
  await writeFile(
    path.join(dir, 'a.jsonl'),
    lines(
      {
        id: 'c1',
        run: 'r1',
        item: 'i1',
        model: 'm-a',
        request: { questions: { yes: { type: 'noul', text: 'Is it?' }, team: { type: 'choice' } } },
        response: { answers: { yes: noul(0.8), team: choice('billing', 0.7) } },
        tags: { lang: 'en' },
        thresholds: { yes: 0.6 },
        ms: 120,
      },
      // Record labels win over label lines.
      { id: 'c2', run: 'r1', item: 'i2', answers: { yes: { type: 'noul', p: 0.3 } }, labels: { yes: 'Yes ' } },
      { id: 'c3', run: 'r2', item: 'i3', response: { answers: { yes: noul(0.4), team: choice('3', 0.9), s: { type: 'score', score: 4 } } } },
      { id: 'c4', run: 'r2', item: 'i4', response: { answers: { yes: noul(0.6) } } },
      { id: 'c1', run: 'r2', response: { answers: { yes: noul(0.1) } } },
      'not json',
    ),
  );
  await writeFile(
    path.join(dir, 'labels.jsonl'),
    lines(
      { item: 'i1', question: 'yes', expected: false },
      { item: 'i1', question: 'yes', expected: true }, // the later line wins
      { item: 'i1', question: 'team', expected: 'billing' },
      { item: 'i2', question: 'yes', expected: false },
      { item: 'i3', question: 'yes', expected: 0.7 },
      { item: 'i3', question: 'team', expected: 3 },
      { item: 'i4', question: 'yes', expected: 'maybe' }, // unreadable as yes/no: no y
    ),
  );
  return dir;
}

const plain = (x: unknown) => JSON.parse(JSON.stringify(x));

async function snapshot(store: Store) {
  return plain({
    overview: await store.overview(),
    yes: await store.rows({ questions: ['yes'] }),
    pooled: await store.rows({ questions: ['yes', 'team', 's'], runs: ['r2'] }),
    record: await store.record('c1'),
    missing: await store.record('nope'),
  });
}

test('DuckStore gives the same answers as MemoryStore', async () => {
  const dir = await fixture();
  const mem = await snapshot(await MemoryStore.open([dir]));
  const duck = await DuckStore.open(':memory:', [dir]);
  try {
    const got = await snapshot(duck);
    // Skipped lines carry the file path as given in both; compare everything else exactly.
    assert.deepEqual(got, mem);
    assert.equal(mem.overview.labeled, 5);
    assert.deepEqual(
      mem.yes.rows.map((r: { id: string; y?: boolean }) => [r.id, r.y]),
      [['c1', true], ['c2', true], ['c3', true], ['c4', undefined]],
    );
    assert.deepEqual(Object.keys(mem.yes.definitions), [mem.yes.rows[0].qv]);
  } finally {
    await duck.close();
  }
});

test('DuckStore reads only new or changed files and forgets removed ones', async () => {
  const dir = await fixture();
  const db = path.join(dir, 'index', 'index.duckdb');
  const first = await DuckStore.open(db, [dir]);
  assert.deepEqual([first.report.files, first.report.read, first.report.dropped], [2, 2, 0]);
  await first.close();

  const again = await DuckStore.open(db, [dir]);
  assert.deepEqual([again.report.read, again.report.dropped], [0, 0]);
  await again.close();

  // Change one file, add one, remove one.
  const a = path.join(dir, 'a.jsonl');
  await writeFile(a, lines({ id: 'n1', run: 'r9', item: 'i1', answers: { yes: { type: 'noul', p: 0.9 } } }));
  await utimes(a, new Date(), new Date(Date.now() + 5000));
  await writeFile(path.join(dir, 'b.jsonl'), lines({ id: 'b1', run: 'r8', answers: { yes: { type: 'noul', p: 0.2 } } }));
  await rm(path.join(dir, 'labels.jsonl'));
  const later = await DuckStore.open(db, [dir]);
  try {
    assert.deepEqual([later.report.files, later.report.read, later.report.dropped], [2, 2, 2]);
    const overview = await later.overview();
    assert.deepEqual(
      overview.runs.map((r) => r.run),
      ['r8', 'r9'],
    );
    assert.equal(overview.labeled, 0);
    assert.deepEqual(plain(await later.overview()), plain(await (await MemoryStore.open([dir])).overview()));
  } finally {
    await later.close();
  }
});

test('the server picks up new log files when the page asks for the overview', async () => {
  const dir = await fixture();
  const store = await DuckStore.open(':memory:', [dir]);
  const handle = handler(store);
  const server = createServer(async (req, res) => {
    if (!(await handle(req, res))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  const runs = async () => ((await (await fetch(`http://127.0.0.1:${port}/api/overview`)).json()).runs as { run: string }[]).map((r) => r.run);
  try {
    assert.deepEqual(await runs(), ['r1', 'r2']);
    await writeFile(path.join(dir, 'new.jsonl'), lines({ id: 'z1', run: 'r3', answers: { yes: { type: 'noul', p: 0.5 } } }));
    // Syncs closer together than a second are skipped; wait that out.
    await new Promise((r) => setTimeout(r, 1100));
    assert.deepEqual(await runs(), ['r1', 'r2', 'r3']);
    // Queries run one at a time, so a sync never overlaps them.
    const [a, b] = await Promise.all([store.rows({ questions: ['yes'] }), store.refresh(0), store.overview()]);
    assert.equal(a.rows.length, 5);
    assert.equal(b.changed, false);
  } finally {
    server.close();
    await store.close();
  }
});

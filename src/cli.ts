#!/usr/bin/env node
/**
 * s1scope view <file-or-folder>... [--port 4747] [--db .s1scope/index.duckdb] [--memory]
 * Indexes every .jsonl under the given paths and serves the viewer on 127.0.0.1.
 *
 * By default the index is a DuckDB file (see duckdb.ts): later starts only read new or changed
 * files. --memory skips the index and holds everything in memory, as before.
 */
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Store } from './api.ts';
import { handler } from './server.ts';

const usage = 'usage: s1scope view <file-or-folder>... [--port 4747] [--db .s1scope/index.duckdb] [--memory]';
const [command, ...rest] = process.argv.slice(2);
if (command !== 'view') {
  console.error(usage);
  process.exit(command ? 1 : 0);
}
const options: Record<string, string> = {};
const flags = new Set<string>();
const paths: string[] = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a === '--port' || a === '--db') options[a.slice(2)] = rest[++i];
  else if (a === '--memory') flags.add('memory');
  else if (a.startsWith('--')) {
    console.error(`unknown option ${a}\n${usage}`);
    process.exit(1);
  } else paths.push(a);
}
if (!paths.length) {
  console.error(usage);
  process.exit(1);
}
const port = Number(options.port ?? 4747);

const started = performance.now();
let store: Store;
if (flags.has('memory')) {
  const { MemoryStore } = await import('./store.ts');
  store = await MemoryStore.open(paths);
} else {
  const { DuckStore } = await import('./duckdb.ts');
  const db = options.db ?? path.join('.s1scope', 'index.duckdb');
  try {
    const duck = await DuckStore.open(db, paths);
    const r = duck.report;
    console.log(`index ${db}: ${r.files} files, read ${r.read}, dropped ${r.dropped}`);
    store = duck;
  } catch (e) {
    const message = String((e as Error).message ?? e);
    console.error(
      /lock/i.test(message)
        ? `${db} is in use, probably by another s1scope. Stop it, or pass --db with another file.\n${message}`
        : message,
    );
    process.exit(1);
  }
}
const o = await store.overview();
console.log(`${o.calls} calls, ${o.answers} answers, ${o.labeled} with a label (${((performance.now() - started) / 1000).toFixed(1)} s)`);
if (o.skippedCount) console.log(`skipped ${o.skippedCount} lines, first: ${JSON.stringify(o.skipped[0])}`);

// Built layout: dist/src/cli.js next to dist/web/. From source (tsx), the page must be built first.
const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..', here.endsWith(path.join('dist', 'src')) ? 'web' : path.join('dist', 'web'));
const handle = handler(store, webRoot);
const server = createServer(async (req, res) => {
  if (!(await handle(req, res))) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found. If you run from source, run `npm run build` first, or use `npm run dev`.');
  }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/`));

// Close the index cleanly so the next start does not have to replay its log.
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    server.close();
    store.close().finally(() => process.exit(0));
  });

#!/usr/bin/env node
/**
 * s1scope view <file-or-folder>... [--port 4747]
 * Loads every .jsonl under the given paths and serves the viewer on 127.0.0.1.
 */
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from './load.ts';
import { handler } from './server.ts';

const usage = 'usage: s1scope view <file-or-folder>... [--port 4747]';
const args = process.argv.slice(2);
const [command, ...rest] = args;
if (command !== 'view') {
  console.error(usage);
  process.exit(command ? 1 : 0);
}
const portAt = rest.indexOf('--port');
const port = portAt >= 0 ? Number(rest[portAt + 1]) : 4747;
const paths = rest.filter((_, i) => portAt < 0 || (i !== portAt && i !== portAt + 1));
if (!paths.length) {
  console.error(usage);
  process.exit(1);
}

const data = await load(paths);
console.log(
  `${data.records.size} calls, ${data.rows.length} answers, ${data.rows.filter((r) => r.y !== undefined).length} with a label`,
);
if (data.skipped.length) console.log(`skipped ${data.skipped.length} lines, first: ${JSON.stringify(data.skipped[0])}`);

// Built layout: dist/src/cli.js next to dist/web/. From source (tsx), the page must be built first.
const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..', here.endsWith(path.join('dist', 'src')) ? 'web' : path.join('dist', 'web'));
const handle = handler(async () => data, webRoot);
createServer(async (req, res) => {
  if (!(await handle(req, res))) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found. If you run from source, run `npm run build` first, or use `npm run dev`.');
  }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/`));

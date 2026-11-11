/** HTTP handler for the viewer: the data API plus, when built, the static page. */
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { RowQuery, Store } from './api.ts';

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function json(req: IncomingMessage, res: ServerResponse, body: unknown, status = 200) {
  send(req, res, Buffer.from(JSON.stringify(body)), status);
}

function send(req: IncomingMessage, res: ServerResponse, raw: Buffer, status = 200, gzipped?: Buffer) {
  const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' };
  if (gzip) headers['Content-Encoding'] = 'gzip';
  res.writeHead(status, headers);
  // Level 1: answers can be tens of MB, and on localhost speed matters more than size.
  res.end(gzip ? (gzipped ?? gzipSync(raw, { level: 1 })) : raw);
}

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const strings = (x: unknown) => Array.isArray(x) && x.every((s) => typeof s === 'string');

/** Returns true when it handled the request. `webRoot` is the built page; leave it out in dev (Vite serves the page). */
export function handler(store: Store, webRoot?: string) {
  // The overview only changes when the store picks up new files, so keep it until then.
  let overview: Promise<{ raw: Buffer; gzipped: Buffer }> | undefined;
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/api/overview') {
        // A page load is when new logs should show up: sync first, and rebuild the overview if anything changed.
        if (store.refresh && (await store.refresh()).changed) overview = undefined;
        overview ??= store.overview().then((o) => {
          const raw = Buffer.from(JSON.stringify(o));
          return { raw, gzipped: gzipSync(raw) };
        });
        const { raw, gzipped } = await overview;
        send(req, res, raw, 200, gzipped);
        return true;
      }
      if (url.pathname === '/api/rows') {
        if (req.method !== 'POST') return json(req, res, { error: 'POST a RowQuery' }, 405), true;
        const q = (await body(req)) as RowQuery;
        if (!strings(q.questions) || (q.runs !== undefined && !strings(q.runs)))
          return json(req, res, { error: 'questions (and runs, if given) must be lists of strings' }, 400), true;
        const query = { questions: q.questions, runs: q.runs };
        if (store.rowsJson) send(req, res, Buffer.from(await store.rowsJson(query)));
        else json(req, res, await store.rows(query));
        return true;
      }
      if (url.pathname === '/api/record') {
        const record = await store.record(url.searchParams.get('id') ?? '');
        record ? json(req, res, record) : json(req, res, { error: 'not found' }, 404);
        return true;
      }
    } catch (e) {
      json(req, res, { error: String((e as Error).message ?? e) }, 500);
      return true;
    }
    if (!webRoot) return false;
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(webRoot, rel);
    if (!file.startsWith(path.resolve(webRoot))) return false;
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
      return true;
    } catch {
      return false;
    }
  };
}

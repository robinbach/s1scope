/** HTTP handler for the viewer: the data API plus, when built, the static page. */
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Loaded } from './load.ts';

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
  res.end(gzip ? (gzipped ?? gzipSync(raw)) : raw);
}

// The rows payload is large (tens of MB for a few hundred thousand answers); build it once per load.
const rowsCache = new WeakMap<Loaded, { raw: Buffer; gzipped: Buffer }>();
function rowsPayload(data: Loaded) {
  let hit = rowsCache.get(data);
  if (!hit) {
    const raw = Buffer.from(
      JSON.stringify({ rows: data.rows, skipped: data.skipped.slice(0, 50), skippedCount: data.skipped.length }),
    );
    hit = { raw, gzipped: gzipSync(raw) };
    rowsCache.set(data, hit);
  }
  return hit;
}

/** Returns true when it handled the request. `webRoot` is the built page; leave it out in dev (Vite serves the page). */
export function handler(getData: () => Promise<Loaded>, webRoot?: string) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/rows') {
      const { raw, gzipped } = rowsPayload(await getData());
      send(req, res, raw, 200, gzipped);
      return true;
    }
    if (url.pathname === '/api/record') {
      const record = (await getData()).records.get(url.searchParams.get('id') ?? '');
      record ? json(req, res, record) : json(req, res, { error: 'not found' }, 404);
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

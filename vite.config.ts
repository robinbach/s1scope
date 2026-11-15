import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import type { Store } from './src/api.ts';
import { handler } from './src/server.ts';

/** Closing the store of the dev server that is being restarted, if any; the new one waits for it (see api()). */
const closing = Symbol.for('s1scope.dev.closing');
type Global = typeof globalThis & { [closing]?: Promise<void> };

/** Opens the dev store: the DuckDB index like `s1scope view`, or everything in memory with S1SCOPE_MEMORY=1. */
async function openStore(paths: string[]): Promise<Store> {
  await (globalThis as Global)[closing];
  if (process.env.S1SCOPE_MEMORY === '1') {
    const { MemoryStore } = await import('./src/store.ts');
    return MemoryStore.open(paths);
  }
  const { DuckStore } = await import('./src/duckdb.ts');
  // Its own file, so the dev server and `s1scope view` can run at the same time.
  const db = process.env.S1SCOPE_DB ?? path.join('.s1scope', 'dev.duckdb');
  const duck = await DuckStore.open(db, paths);
  const r = duck.report;
  console.log(`s1scope: index ${db}: ${r.files} files, read ${r.read}, dropped ${r.dropped}`);
  return duck;
}

/**
 * In dev, serve the data API from the paths in S1SCOPE_DATA (separated by the OS path delimiter or commas).
 * Vite restarts the server when this file or the server code changes; the old index is closed first,
 * because a DuckDB file can only be open in one place.
 */
function api(): Plugin {
  return {
    name: 's1scope-api',
    configureServer(server) {
      const paths = (process.env.S1SCOPE_DATA ?? 'data').split(/[,;]/).filter(Boolean);
      const opened = openStore(paths);
      opened.catch((e) => console.error(`s1scope: could not open the data: ${(e as Error).message ?? e}`));
      const store: Store = {
        overview: async () => (await opened).overview(),
        rows: async (q) => (await opened).rows(q),
        rowsJson: async (q) => {
          const s = await opened;
          return s.rowsJson ? s.rowsJson(q) : JSON.stringify(await s.rows(q));
        },
        record: async (id) => (await opened).record(id),
        refresh: async () => {
          const s = await opened;
          return s.refresh ? s.refresh() : { changed: false };
        },
        close: async () => (await opened).close(),
      };
      server.httpServer?.once('close', () => {
        (globalThis as Global)[closing] = opened.then((s) => s.close()).catch(() => undefined);
      });
      const handle = handler(store);
      server.middlewares.use(async (req, res, next) => {
        if (!(await handle(req, res))) next();
      });
    },
  };
}

export default defineConfig({
  root: 'web',
  plugins: [react(), api()],
  // Plot and React together are ~520 kB minified; it is a local tool, one chunk is fine.
  build: { outDir: '../dist/web', emptyOutDir: true, chunkSizeWarningLimit: 800 },
  server: { host: '127.0.0.1' },
});

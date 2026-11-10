import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import type { Store } from './src/api.ts';
import { handler } from './src/server.ts';
import { MemoryStore } from './src/store.ts';

/** In dev, serve the data API from the paths in S1SCOPE_DATA (separated by the OS path delimiter or commas), held in memory. */
function api(): Plugin {
  return {
    name: 's1scope-api',
    configureServer(server) {
      const paths = (process.env.S1SCOPE_DATA ?? 'data').split(/[,;]/).filter(Boolean);
      const opened = MemoryStore.open(paths);
      const store: Store = {
        overview: async () => (await opened).overview(),
        rows: async (q) => (await opened).rows(q),
        record: async (id) => (await opened).record(id),
        close: async () => (await opened).close(),
      };
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

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { load } from './src/load.ts';
import { handler } from './src/server.ts';

/** In dev, serve the data API from the paths in S1SCOPE_DATA (separated by the OS path delimiter or commas). */
function api(): Plugin {
  return {
    name: 's1scope-api',
    configureServer(server) {
      const paths = (process.env.S1SCOPE_DATA ?? 'data').split(/[,;]/).filter(Boolean);
      const handle = handler(() => load(paths));
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

/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { getRequestListener } from '@hono/node-server';

/** Serves the /api routes (server/app.ts) from the Vite dev server. */
function apiPlugin(): Plugin {
  let cached: { mod: unknown; listener: ReturnType<typeof getRequestListener> } | null = null;
  return {
    name: 'mixtape-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        try {
          const mod = await server.ssrLoadModule('/server/app.ts');
          if (!cached || cached.mod !== mod) {
            const app = (mod as typeof import('./server/app')).createApp(process.env);
            cached = { mod, listener: getRequestListener(app.fetch) };
          }
          await cached.listener(req, res);
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Make .env values (including non-VITE_ ones) visible to the API routes.
  const env = loadEnv(mode, process.cwd(), '');
  for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

  return {
    plugins: [react(), apiPlugin()],
    server: {
      // Spotify only accepts http redirect URIs on loopback IPs, not "localhost".
      host: '127.0.0.1',
      port: 5173,
    },
    preview: { host: '127.0.0.1', port: 4173 },
    build: {
      chunkSizeWarningLimit: 1100,
      rollupOptions: {
        output: { manualChunks: { maplibre: ['maplibre-gl'] } },
      },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    },
  };
});

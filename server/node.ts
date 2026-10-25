// Production server: the built app from dist/ plus the /api routes.
//   npm run build && npm start
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createApp } from './app';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

// Load .env when present (no extra dependency needed).
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('dist/ is missing — run `npm run build` first.');
  process.exit(1);
}

const server = new Hono();
server.route('/', createApp(process.env));
server.use('/*', serveStatic({ root: path.relative(process.cwd(), dist) || '.' }));
// Single-page app: every other path (including /callback) gets index.html.
const indexHtml = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
server.get('*', (c) => c.html(indexHtml));

const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? '127.0.0.1';
serve({ fetch: server.fetch, port, hostname }, () => {
  console.log(`26.2 Mixtape running at http://${hostname}:${port}`);
});

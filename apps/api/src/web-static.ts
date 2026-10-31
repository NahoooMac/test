// Serves the built web app (apps/web/dist) from the API, so production is one process and one
// origin: the HttpOnly session cookie and the live event stream need no CORS.
//  - /assets/* are content-hashed by Vite → cached for a year, immutable
//  - index.html is never cached, so a deploy is picked up on the next load
//  - any other non-API GET falls back to index.html (client-side routes like /deliveries/:id)
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

// Yandex Maps JS API v2.1 loads its code, tiles and data from these hosts. Verified in the browser
// (2026-10-31): the map, custom markers and route line work without 'unsafe-eval'.
const YANDEX = [
  'https://api-maps.yandex.ru',
  'https://yastatic.net',
  'https://*.maps.yandex.net',
  'https://*.yandex.ru',
  'https://*.yandex.net',
  // Yandex's own usage counters (e.g. the "Open in Yandex Maps" link).
  'https://yandex.com',
  'https://*.yandex.com',
];

export const WEB_CSP = [
  "default-src 'self'",
  `script-src 'self' ${YANDEX.join(' ')}`,
  // Yandex positions map elements with inline styles; React uses style attributes too.
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${YANDEX.join(' ')}`,
  `connect-src 'self' ${YANDEX.join(' ')}`,
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function securityHeaders(reply: FastifyReply) {
  reply
    .header('Content-Security-Policy', WEB_CSP)
    .header('Referrer-Policy', 'strict-origin-when-cross-origin')
    // Riders share location; nothing needs camera or microphone.
    .header('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=()')
    .header('X-Content-Type-Options', 'nosniff');
}

export async function serveWebApp(app: FastifyInstance, distDir: string) {
  const root = resolve(distDir);
  const indexHtml = await readFile(join(root, 'index.html'));

  const sendIndex = (reply: FastifyReply) => {
    securityHeaders(reply);
    return reply.header('Cache-Control', 'no-cache').type(TYPES['.html']!).send(indexHtml);
  };

  app.get('/*', async (req, reply) => {
    const path = decodeURIComponent((req.url.split('?')[0] ?? '/').replace(/^\/+/, ''));
    // Unknown API routes keep returning JSON errors, never the HTML shell.
    if (path === 'api' || path.startsWith('api/')) {
      return reply
        .status(404)
        .send({ error: { code: 'NOT_FOUND', message: `No route for GET /${path}` } });
    }
    if (path === '' || path === 'index.html') return sendIndex(reply);

    const file = resolve(root, normalize(path));
    // Path traversal guard: never serve anything outside the build folder.
    if (file !== root && !file.startsWith(root + sep)) return reply.status(404).send();

    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      // A missing asset is a real 404; anything else is a client-side route.
      if (path.startsWith('assets/')) return reply.status(404).send();
      return sendIndex(reply);
    }
    securityHeaders(reply);
    reply.header(
      'Cache-Control',
      path.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    );
    return reply
      .type(TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream')
      .send(await readFile(file));
  });
}

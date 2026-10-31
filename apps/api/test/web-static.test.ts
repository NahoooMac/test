import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import { serveWebApp, WEB_CSP } from '../src/web-static.ts';

let dir: string;
const app = Fastify();

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dp-web-'));
  await mkdir(join(dir, 'assets'));
  await writeFile(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
  await writeFile(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  await writeFile(join(dir, 'favicon.svg'), '<svg/>');
  // A secret next to (outside) the build folder that must never be served.
  await writeFile(join(dir, '..', 'dp-secret.txt'), 'secret');
  await serveWebApp(app, dir);
  app.get('/api/health', async () => ({ ok: true }));
});

afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
  await rm(join(dir, '..', 'dp-secret.txt'), { force: true });
});

describe('web app serving', () => {
  it('serves index.html uncached, with the web security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['content-security-policy']).toBe(WEB_CSP);
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['permissions-policy']).toContain('camera=()');
  });

  it('falls back to the app for client-side routes', async () => {
    for (const url of [
      '/deliveries/123',
      '/rider/earnings',
      '/t/ABCDEF',
      '/admin/reconciliation?x=1',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.body).toContain('id="root"');
    }
  });

  it('caches hashed assets forever and 404s missing ones', async () => {
    const js = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(js.statusCode).toBe(200);
    expect(js.headers['content-type']).toContain('text/javascript');
    expect(js.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await app.inject({ method: 'GET', url: '/assets/missing.js' })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/favicon.svg' })).headers['cache-control'],
    ).toBe('public, max-age=3600');
  });

  it('keeps API routes and API 404s as JSON', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toEqual({ ok: true });
    const missing = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('NOT_FOUND');
  });

  it('never serves files outside the build folder', async () => {
    for (const url of [
      '/../dp-secret.txt',
      '/%2e%2e/dp-secret.txt',
      '/assets/..%2f..%2fdp-secret.txt',
      '/..%5cdp-secret.txt',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.body, url).not.toContain('secret');
    }
  });
});

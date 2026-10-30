import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiErrorSchema, healthSchema, readinessSchema } from '@dp/shared';
import { createTestApp } from './helpers.ts';

let ctx: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

describe('health', () => {
  it('GET /api/health reports liveness', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(healthSchema.parse(res.json()).status).toBe('ok');
  });

  it('GET /api/health/ready checks the database', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(readinessSchema.parse(res.json())).toEqual({
      status: 'ready',
      database: { driver: 'pglite', ok: true },
    });
  });

  it('sets security headers', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });
});

describe('error contract', () => {
  it('unknown routes return the standard error shape', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('NOT_FOUND');
  });

  it('GET /api/auth/me is 401 without a session', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('UNAUTHENTICATED');
  });
});

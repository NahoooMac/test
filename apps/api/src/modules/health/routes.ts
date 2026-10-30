import type { FastifyInstance } from 'fastify';
import type { Health, Readiness } from '@dp/shared';
import type { Database } from '../../db/client.ts';

export async function healthRoutes(app: FastifyInstance, opts: { database: Database }) {
  // Liveness: the process is up. Never touches the database.
  app.get('/health', async (): Promise<Health> => ({
    status: 'ok',
    service: 'api',
    time: new Date().toISOString(),
  }));

  // Readiness: dependencies are reachable.
  app.get('/health/ready', async (_req, reply): Promise<Readiness> => {
    const ok = await opts.database.ping();
    reply.status(ok ? 200 : 503);
    return { status: ok ? 'ready' : 'not_ready', database: { driver: opts.database.driver, ok } };
  });
}

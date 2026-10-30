import type { FastifyInstance } from 'fastify';
import { AppError, unauthenticated } from '../../shared/errors.ts';

// Phase 2 placeholders so the web app can be built against the real contract.
// Phase 3 replaces these with cookie → session lookup, OTP request/verify and logout.
export async function authRoutes(app: FastifyInstance) {
  app.get('/auth/me', async () => {
    throw unauthenticated();
  });

  app.post('/auth/otp/request', async () => {
    throw new AppError(503, 'NOT_AVAILABLE_YET', 'Phone sign-in is not available yet. It is being built in Phase 3.');
  });
}

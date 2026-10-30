import type { FastifyError, FastifyInstance } from 'fastify';
import type { ApiError } from '@dp/shared';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly fields: Record<string, string> | undefined;

  constructor(statusCode: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.fields = fields;
  }
}

export const unauthenticated = () =>
  new AppError(401, 'UNAUTHENTICATED', 'You need to sign in to continue.');
export const forbidden = () =>
  new AppError(403, 'FORBIDDEN', 'You do not have permission to do that.');

function body(code: string, message: string, fields?: Record<string, string>): ApiError {
  return { error: { code, message, ...(fields ? { fields } : {}) } };
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send(body('NOT_FOUND', `No route for ${req.method} ${req.url.split('?')[0]}`));
  });

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send(body(err.code, err.message, err.fields));
    }
    if (err.validation) {
      const fields: Record<string, string> = {};
      for (const v of err.validation) {
        const key = v.instancePath.replace(/^\//, '').replace(/\//g, '.') || 'body';
        fields[key] = v.message ?? 'is invalid';
      }
      return reply.status(400).send(body('VALIDATION_FAILED', 'Some fields are invalid.', fields));
    }
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    return reply
      .status(status)
      .send(
        body(
          status >= 500 ? 'INTERNAL' : (err.code ?? 'BAD_REQUEST'),
          status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message,
        ),
      );
  });
}

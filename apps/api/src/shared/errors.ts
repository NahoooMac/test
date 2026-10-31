import type { FastifyError, FastifyInstance } from 'fastify';
import type { z } from 'zod';
import type { ApiError } from '@dp/shared';

export interface AppErrorOptions {
  fields?: Record<string, string>;
  /** Machine-readable extras for the client, e.g. { retryAfterSec: 60 }. Never secrets. */
  details?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly fields: Record<string, string> | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(statusCode: number, code: string, message: string, opts: AppErrorOptions = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.fields = opts.fields;
    this.details = opts.details;
  }
}

export const unauthenticated = () =>
  new AppError(401, 'UNAUTHENTICATED', 'You need to sign in to continue.');
export const forbidden = () =>
  new AppError(403, 'FORBIDDEN', 'You do not have permission to do that.');
export const tooManyRequests = (retryAfterSec: number) =>
  new AppError(429, 'TOO_MANY_REQUESTS', 'Too many attempts. Please wait and try again.', {
    details: { retryAfterSec },
  });

/** Parses a request body with zod; failures become a 400 with per-field messages. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || 'body';
    fields[key] ??= issue.message;
  }
  throw new AppError(400, 'VALIDATION_FAILED', 'Some fields are invalid.', { fields });
}

function body(
  code: string,
  message: string,
  fields?: Record<string, string>,
  details?: Record<string, unknown>,
): ApiError {
  return {
    error: { code, message, ...(fields ? { fields } : {}), ...(details ? { details } : {}) },
  };
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((req, reply) => {
    reply
      .status(404)
      .send(body('NOT_FOUND', `No route for ${req.method} ${req.url.split('?')[0]}`));
  });

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      const retryAfter = err.details?.retryAfterSec;
      if (typeof retryAfter === 'number') reply.header('Retry-After', String(retryAfter));
      return reply
        .status(err.statusCode)
        .send(body(err.code, err.message, err.fields, err.details));
    }
    if (err.validation) {
      const fields: Record<string, string> = {};
      for (const v of err.validation) {
        const key = v.instancePath.replace(/^\//, '').replace(/\//g, '.') || 'body';
        fields[key] = v.message ?? 'is invalid';
      }
      return reply.status(400).send(body('VALIDATION_FAILED', 'Some fields are invalid.', fields));
    }
    const status =
      err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
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

/** Postgres unique_violation, unwrapped from Drizzle's error wrapper if needed. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

/** Name of the violated constraint/index, when the driver reports it. */
export function violatedConstraint(err: unknown): string | undefined {
  const e = err as { constraint?: string; cause?: { constraint?: string } } | null;
  return e?.constraint ?? e?.cause?.constraint;
}

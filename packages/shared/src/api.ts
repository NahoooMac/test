import { z } from 'zod';
import { LANGUAGES, USER_ROLES, USER_STATUSES } from './enums.ts';

/** Every API error response has this shape. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fields: z.record(z.string(), z.string()).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const healthSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  time: z.string(),
});
export type Health = z.infer<typeof healthSchema>;

export const readinessSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  database: z.object({ driver: z.enum(['pg', 'pglite']), ok: z.boolean() }),
});
export type Readiness = z.infer<typeof readinessSchema>;

export const currentUserSchema = z.object({
  id: z.string().uuid(),
  phone: z.string(),
  fullName: z.string().nullable(),
  role: z.enum(USER_ROLES),
  status: z.enum(USER_STATUSES),
  preferredLanguage: z.enum(LANGUAGES),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

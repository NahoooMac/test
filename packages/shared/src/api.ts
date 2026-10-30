import { z } from 'zod';
import { LANGUAGES, USER_ROLES, USER_STATUSES } from './enums.ts';

/** Every API error response has this shape. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fields: z.record(z.string(), z.string()).optional(),
    details: z.record(z.string(), z.unknown()).optional(),
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

// ── Auth contract ────────────────────────────────────────────────────────────

export const otpRequestBodySchema = z.object({
  phone: z.string().max(32),
});

/** Same shape whether or not the phone already has an account (no enumeration). */
export const otpChallengeSchema = z.object({
  challengeId: z.string().uuid(),
  maskedPhone: z.string(),
  expiresInSec: z.number().int(),
  resendAfterSec: z.number().int(),
});
export type OtpChallenge = z.infer<typeof otpChallengeSchema>;

export const otpVerifyBodySchema = z.object({
  challengeId: z.string().uuid('Request a new code.'),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});

export const otpVerifyResponseSchema = z.object({
  user: currentUserSchema,
  needsProfile: z.boolean(),
});
export type OtpVerifyResponse = z.infer<typeof otpVerifyResponseSchema>;

export const updateProfileBodySchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, 'Enter your name.')
      .max(80, 'Use 80 characters or fewer.')
      .optional(),
    preferredLanguage: z.enum(LANGUAGES).optional(),
  })
  .refine((v) => v.fullName !== undefined || v.preferredLanguage !== undefined, {
    message: 'Nothing to update.',
  });

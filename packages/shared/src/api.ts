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
  /** Development only (console SMS provider): the code itself, shown on screen. Never in production. */
  devCode: z.string().optional(),
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

/** Admin usernames: stored and compared lowercase. */
export const ADMIN_USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
export const ADMIN_PASSWORD_MIN = 10;

export const adminLoginBodySchema = z.object({
  username: z.string().trim().toLowerCase().min(1, 'Enter your username.').max(64),
  password: z.string().min(1, 'Enter your password.').max(200),
});

export const adminChangePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.').max(200),
    newPassword: z
      .string()
      .min(ADMIN_PASSWORD_MIN, `Use at least ${ADMIN_PASSWORD_MIN} characters.`)
      .max(200, 'Use 200 characters or fewer.'),
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ['newPassword'],
    message: 'Choose a password different from the current one.',
  });

const otpCode = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.');

/** Password was right and 2-step is on: a code went to the recovery phone. */
export interface AdminTwoStepChallenge {
  twoStep: true;
  challengeId: string;
  maskedPhone: string;
  /** Binds the code step to this password check; send it back with the code. */
  ticket: string;
}
export type AdminLoginResponse = OtpVerifyResponse | AdminTwoStepChallenge;

export const adminTwoStepVerifyBodySchema = z.object({
  ticket: z.string().min(10).max(200),
  challengeId: z.string().uuid('Request a new code.'),
  code: otpCode,
});

export interface AdminSecurity {
  username: string;
  recoveryPhone: string | null;
  twoStep: boolean;
}

export const adminRecoveryPhoneBodySchema = z.object({ phone: z.string().max(32) });
export const adminConfirmCodeBodySchema = z.object({
  challengeId: z.string().uuid('Request a new code.'),
  code: otpCode,
});
export const adminTwoStepBodySchema = z.object({ enabled: z.boolean() });

export const adminForgotBodySchema = z.object({
  username: z.string().trim().toLowerCase().min(1, 'Enter your username.').max(64),
});
/** Same answer whether or not the username exists or has a recovery phone. */
export interface AdminForgotResponse {
  challengeId: string;
}
export const adminResetBodySchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(64),
  challengeId: z.string().uuid('Request a new code.'),
  code: otpCode,
  newPassword: z
    .string()
    .min(ADMIN_PASSWORD_MIN, `Use at least ${ADMIN_PASSWORD_MIN} characters.`)
    .max(200, 'Use 200 characters or fewer.'),
});

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

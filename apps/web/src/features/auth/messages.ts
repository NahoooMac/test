import type { TFunction } from 'i18next';
import { ApiRequestError } from '../../lib/api.ts';

export function formatDuration(t: TFunction, seconds: number): string {
  if (seconds >= 90) return t('time.minutes', { count: Math.ceil(seconds / 60) });
  return t('time.seconds', { count: Math.max(1, Math.ceil(seconds)) });
}

/** Translates API error codes into the user's language; falls back to the server message. */
export function authErrorMessage(t: TFunction, err: unknown): string {
  if (!(err instanceof ApiRequestError)) return t('errors.genericTitle');
  if (err.isNetwork) return err.message;
  const retry = err.detailNumber('retryAfterSec') ?? 60;
  switch (err.code) {
    case 'INVALID_CODE': {
      if (err.details?.expired) return t('auth.errors.CODE_EXPIRED');
      const remaining = err.detailNumber('attemptsRemaining');
      return remaining === undefined
        ? t('auth.errors.INVALID_CODE')
        : t('auth.errors.INVALID_CODE_remaining', { count: remaining });
    }
    case 'AUTH_LOCKED':
    case 'TOO_MANY_REQUESTS':
      return t(`auth.errors.${err.code}`, { time: formatDuration(t, retry) });
    case 'SMS_UNAVAILABLE':
    case 'SMS_SEND_FAILED':
    case 'ACCOUNT_SUSPENDED':
      return t(`auth.errors.${err.code}`);
    default:
      return err.message;
  }
}

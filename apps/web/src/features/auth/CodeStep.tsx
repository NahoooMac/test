import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { normalizeEthiopianPhone, type OtpChallenge, type OtpVerifyResponse } from '@dp/shared';
import { api, ApiRequestError } from '../../lib/api.ts';
import { formatClock, useCountdown } from '../../lib/useCountdown.ts';
import { Button, Notice, OtpInput, useToast } from '../../ui/index.ts';
import { authErrorMessage } from './messages.ts';

export function CodeStep({
  challenge,
  phoneInput,
  submitSize = 'lg',
  onVerified,
  onChangeNumber,
  onResent,
}: {
  challenge: OtpChallenge;
  phoneInput: string;
  submitSize?: 'md' | 'lg';
  onVerified: (result: OtpVerifyResponse) => void;
  onChangeNumber: () => void;
  onResent: (challenge: OtpChallenge) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [resendAt, setResendAt] = useState(() => Date.now() + challenge.resendAfterSec * 1000);
  const resendLeft = useCountdown(resendAt);
  const lastSubmitted = useRef<string | null>(null);

  const verify = useMutation({
    mutationFn: (value: string) =>
      api<OtpVerifyResponse>('/auth/otp/verify', {
        method: 'POST',
        body: { challengeId: challenge.challengeId, code: value },
      }),
    onSuccess: onVerified,
    onError: () => setCode(''),
  });

  const resend = useMutation({
    mutationFn: () => {
      const n = normalizeEthiopianPhone(phoneInput);
      return api<OtpChallenge>('/auth/otp/request', {
        method: 'POST',
        body: { phone: n.ok ? n.e164 : phoneInput },
      });
    },
    onSuccess: (next) => {
      setResendAt(Date.now() + next.resendAfterSec * 1000);
      verify.reset();
      setCode('');
      lastSubmitted.current = null;
      onResent(next);
      toast(t('auth.code.resent'), 'success');
    },
    onError: (err) => {
      const retry = err instanceof ApiRequestError ? err.detailNumber('retryAfterSec') : undefined;
      if (retry) setResendAt(Date.now() + retry * 1000);
    },
  });

  // Submit automatically once all six digits are in (typed, pasted or SMS-autofilled).
  useEffect(() => {
    if (code.length === 6 && lastSubmitted.current !== code && !verify.isPending) {
      lastSubmitted.current = code;
      verify.mutate(code);
    }
  }, [code, verify]);

  // Android Chrome can read the code straight from the SMS (WebOTP); harmless where unsupported.
  useEffect(() => {
    if (!('OTPCredential' in window)) return;
    const ac = new AbortController();
    navigator.credentials
      .get({ otp: { transport: ['sms'] }, signal: ac.signal } as CredentialRequestOptions)
      .then((cred) => {
        const otp = (cred as unknown as { code?: string } | null)?.code;
        if (otp && /^\d{6}$/.test(otp)) setCode(otp);
      })
      .catch(() => {});
    return () => ac.abort();
  }, [challenge.challengeId]);

  const error = verify.error ?? resend.error;
  const locked = error instanceof ApiRequestError && error.code === 'AUTH_LOCKED';
  const expired = verify.error instanceof ApiRequestError && verify.error.details?.expired === true;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (code.length === 6) {
      lastSubmitted.current = code;
      verify.mutate(code);
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <OtpInput
        label={t('auth.code.digit')}
        value={code}
        onChange={(v) => {
          setCode(v);
          if (verify.isError && v.length > 0) verify.reset();
        }}
        error={verify.isError}
        busy={verify.isPending}
        disabled={locked}
        autoFocus
      />

      {error && <Notice tone="danger">{authErrorMessage(t, error)}</Notice>}

      <div className="flex flex-col gap-3">
        <Button
          type="submit"
          size={submitSize}
          block
          loading={verify.isPending}
          disabled={code.length !== 6 || locked || expired}
        >
          {t('auth.code.verify')}
        </Button>
        <div className="flex items-center justify-between gap-3 text-sm">
          <button
            type="button"
            onClick={onChangeNumber}
            className="h-11 font-semibold text-ink-2 hover:text-ink"
          >
            {t('auth.code.changeNumber')}
          </button>
          {resendLeft > 0 ? (
            <span className="text-ink-3 tabular" aria-live="polite">
              {t('auth.code.resendIn', { time: formatClock(resendLeft) })}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => resend.mutate()}
              disabled={resend.isPending}
              className="h-11 font-semibold text-accent hover:underline disabled:opacity-50"
            >
              {t('auth.code.resend')}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

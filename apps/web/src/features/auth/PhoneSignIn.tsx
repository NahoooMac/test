import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { normalizeEthiopianPhone, type OtpChallenge } from '@dp/shared';
import { api } from '../../lib/api.ts';
import { Button, EthiopiaFlag, Notice, TextField } from '../../ui/index.ts';
import { authErrorMessage } from './messages.ts';

/**
 * Phone entry step. Validates and normalizes on the client for fast feedback;
 * the server normalizes again and is the authority.
 */
export function PhoneStep({
  initialPhone = '',
  submitSize = 'lg',
  onSent,
}: {
  initialPhone?: string;
  submitSize?: 'md' | 'lg';
  onSent: (challenge: OtpChallenge, phoneInput: string) => void;
}) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState(initialPhone);
  const [touched, setTouched] = useState(false);

  const result = normalizeEthiopianPhone(phone);
  const fieldError = touched && !result.ok ? t(`auth.phoneErrors.${result.reason}`) : undefined;

  const request = useMutation({
    mutationFn: (e164: string) =>
      api<OtpChallenge>('/auth/otp/request', { method: 'POST', body: { phone: e164 } }),
    onSuccess: (challenge) => onSent(challenge, phone),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (result.ok && !request.isPending) request.mutate(result.e164);
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <TextField
        label={t('auth.phoneLabel')}
        prefix={
          <>
            <EthiopiaFlag className="h-3.5 w-5 rounded-[2px]" />
            +251
          </>
        }
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder={t('auth.phonePlaceholder')}
        hint={t('auth.phoneHint')}
        value={phone}
        onChange={(e) => {
          setPhone(e.target.value);
          if (request.isError) request.reset();
        }}
        onBlur={() => phone && setTouched(true)}
        error={fieldError}
      />

      {request.isError && <Notice tone="danger">{authErrorMessage(t, request.error)}</Notice>}

      <div className="flex flex-col gap-3">
        <Button
          type="submit"
          size={submitSize}
          block
          loading={request.isPending}
          trailingIcon={<ArrowRight className="size-5" aria-hidden />}
        >
          {t('auth.sendCode')}
        </Button>
        <p className="text-center text-sm text-ink-3">{t('auth.smsNote')}</p>
      </div>
    </form>
  );
}

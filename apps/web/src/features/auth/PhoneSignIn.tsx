import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { normalizeEthiopianPhone } from '@dp/shared';
import { api, ApiRequestError } from '../../lib/api.ts';
import { Button, Notice, TextField } from '../../ui/index.ts';

/**
 * Phone entry step of OTP sign-in. Validates and normalizes on the client for fast feedback;
 * the server normalizes again and is the authority. The OTP step is added in Phase 3.
 */
export function PhoneSignIn({ submitSize = 'lg' }: { submitSize?: 'md' | 'lg' }) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  const [touched, setTouched] = useState(false);

  const result = normalizeEthiopianPhone(phone);
  const fieldError = touched && !result.ok ? t(`auth.phoneErrors.${result.reason}`) : undefined;

  const request = useMutation({
    mutationFn: (e164: string) =>
      api('/auth/otp/request', { method: 'POST', body: { phone: e164 } }),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (result.ok) request.mutate(result.e164);
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <TextField
        label={t('auth.phoneLabel')}
        prefix="+251"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder={t('auth.phonePlaceholder')}
        hint={t('auth.phoneHint')}
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        onBlur={() => phone && setTouched(true)}
        error={fieldError}
      />

      {request.isError && (
        <Notice tone="danger">
          {request.error instanceof ApiRequestError
            ? request.error.message
            : t('errors.genericTitle')}
        </Notice>
      )}

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

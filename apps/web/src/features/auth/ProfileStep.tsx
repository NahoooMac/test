import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { CurrentUser, Language } from '@dp/shared';
import { api, ApiRequestError } from '../../lib/api.ts';
import { Button, Notice, TextField } from '../../ui/index.ts';

/** One-field profile step for first sign-in. Also stores the UI language the user picked. */
export function ProfileStep({
  submitSize = 'lg',
  onSaved,
}: {
  submitSize?: 'md' | 'lg';
  onSaved: (user: CurrentUser) => void;
}) {
  const { t, i18n } = useTranslation();
  const [name, setName] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api<CurrentUser>('/auth/me', {
        method: 'PATCH',
        body: { fullName: name, preferredLanguage: i18n.language as Language },
      }),
    onSuccess: onSaved,
  });

  const fieldError =
    save.error instanceof ApiRequestError ? save.error.fields?.fullName : undefined;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <TextField
        label={t('auth.profile.nameLabel')}
        placeholder={t('auth.profile.namePlaceholder')}
        autoComplete="name"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={fieldError}
        maxLength={80}
      />
      {save.isError && !fieldError && <Notice tone="danger">{save.error.message}</Notice>}
      <Button
        type="submit"
        size={submitSize}
        block
        loading={save.isPending}
        disabled={name.trim().length < 2}
      >
        {t('auth.profile.save')}
      </Button>
    </form>
  );
}

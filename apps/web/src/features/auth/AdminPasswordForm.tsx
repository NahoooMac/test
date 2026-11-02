import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import {
  ADMIN_PASSWORD_MIN,
  type AdminForgotResponse,
  type AdminLoginResponse,
  type AdminTwoStepChallenge,
  type CurrentUser,
  type OtpVerifyResponse,
} from '@dp/shared';
import { api, ApiRequestError } from '../../lib/api.ts';
import { sessionQueryKey, useSession } from '../../lib/session.tsx';
import { Button, Notice, TextField } from '../../ui/index.ts';

type Mode =
  | { name: 'login' }
  | { name: 'code'; challenge: AdminTwoStepChallenge }
  | { name: 'forgot' }
  | { name: 'reset'; challengeId: string }
  | { name: 'resetDone' };

/**
 * Staff sign-in: username + password, then (if 2-step is on) a code sent to the verified phone.
 * "Forgot password" sends a code to that phone to set a new one.
 */
export function AdminPasswordForm({ homePath }: { homePath: string }) {
  const { t } = useTranslation();
  const session = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>({ name: 'login' });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const finish = (user: CurrentUser) => {
    queryClient.setQueryData(sessionQueryKey, user);
    const from = (location.state as { from?: string } | null)?.from;
    navigate(from && from.startsWith(homePath) ? from : homePath, { replace: true });
  };

  const login = useMutation({
    mutationFn: () =>
      api<AdminLoginResponse>('/auth/admin/login', { method: 'POST', body: { username, password } }),
    onSuccess: (r) => {
      if ('twoStep' in r) {
        setCode('');
        setMode({ name: 'code', challenge: r });
      } else finish(r.user);
    },
    onError: () => setPassword(''),
  });
  const verify = useMutation({
    mutationFn: (c: AdminTwoStepChallenge) =>
      api<OtpVerifyResponse>('/auth/admin/login/verify', {
        method: 'POST',
        body: { ticket: c.ticket, challengeId: c.challengeId, code },
      }),
    onSuccess: (r) => finish(r.user),
  });
  const forgot = useMutation({
    mutationFn: () =>
      api<AdminForgotResponse>('/auth/admin/forgot', { method: 'POST', body: { username } }),
    onSuccess: (r) => {
      setCode('');
      setNewPassword('');
      setMode({ name: 'reset', challengeId: r.challengeId });
    },
  });
  const reset = useMutation({
    mutationFn: (challengeId: string) =>
      api('/auth/admin/reset', {
        method: 'POST',
        body: { username, challengeId, code, newPassword },
      }),
    onSuccess: () => {
      setPassword('');
      setMode({ name: 'resetDone' });
    },
  });

  if (session.data?.role === 'admin') return <Navigate to={homePath} replace />;

  const active = { login, code: verify, forgot, reset, resetDone: login }[mode.name];
  const fields = active.error instanceof ApiRequestError ? active.error.fields : undefined;
  const errorNotice = active.isError && !fields && (
    <Notice tone="danger">{active.error.message}</Notice>
  );
  const codeField = (
    <TextField
      label={t('auth.admin.code')}
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      value={code}
      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
      error={fields?.code}
      autoFocus
    />
  );
  const linkClass = 'self-center text-sm font-semibold text-accent';

  if (mode.name === 'code') {
    return (
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          verify.mutate(mode.challenge);
        }}
      >
        <p className="text-sm text-ink-2">
          {t('auth.admin.codeSent', { phone: mode.challenge.maskedPhone })}
        </p>
        {codeField}
        {errorNotice}
        <Button type="submit" size="lg" block loading={verify.isPending} disabled={code.length !== 6}>
          {t('auth.admin.submit')}
        </Button>
        <button type="button" className={linkClass} onClick={() => setMode({ name: 'login' })}>
          {t('common.back')}
        </button>
      </form>
    );
  }

  if (mode.name === 'forgot') {
    return (
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          forgot.mutate();
        }}
      >
        <p className="text-sm text-ink-2">{t('auth.admin.forgotHint')}</p>
        <TextField
          label={t('auth.admin.username')}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          error={fields?.username}
          autoComplete="username"
          autoCapitalize="none"
          autoFocus
          maxLength={64}
        />
        {errorNotice}
        <Button type="submit" size="lg" block loading={forgot.isPending}>
          {t('auth.admin.sendCode')}
        </Button>
        <button type="button" className={linkClass} onClick={() => setMode({ name: 'login' })}>
          {t('common.back')}
        </button>
      </form>
    );
  }

  if (mode.name === 'reset') {
    return (
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          reset.mutate(mode.challengeId);
        }}
      >
        <p className="text-sm text-ink-2">{t('auth.admin.resetHint')}</p>
        {codeField}
        <TextField
          label={t('auth.admin.newPassword')}
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          error={fields?.newPassword}
          hint={t('auth.admin.passwordRule', { n: ADMIN_PASSWORD_MIN })}
          maxLength={200}
        />
        {errorNotice}
        <Button
          type="submit"
          size="lg"
          block
          loading={reset.isPending}
          disabled={code.length !== 6 || newPassword.length < ADMIN_PASSWORD_MIN}
        >
          {t('auth.admin.setPassword')}
        </Button>
        <button type="button" className={linkClass} onClick={() => setMode({ name: 'login' })}>
          {t('common.back')}
        </button>
      </form>
    );
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {mode.name === 'resetDone' && <Notice tone="success">{t('auth.admin.resetDone')}</Notice>}
      <TextField
        label={t('auth.admin.username')}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        error={fields?.username}
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoFocus
        maxLength={64}
      />
      <TextField
        label={t('auth.admin.password')}
        type={show ? 'text' : 'password'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={fields?.password}
        autoComplete="current-password"
        maxLength={200}
        suffix={
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="flex size-9 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink"
            aria-label={show ? t('auth.admin.hidePassword') : t('auth.admin.showPassword')}
          >
            {show ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
          </button>
        }
      />
      {errorNotice}
      <Button type="submit" size="lg" block loading={login.isPending}>
        {t('auth.admin.submit')}
      </Button>
      <button type="button" className={linkClass} onClick={() => setMode({ name: 'forgot' })}>
        {t('auth.admin.forgot')}
      </button>
    </form>
  );
}

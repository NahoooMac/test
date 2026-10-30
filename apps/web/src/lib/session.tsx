import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { CurrentUser, UserRole } from '@dp/shared';
import { api, ApiRequestError } from './api.ts';
import { Button, ErrorState, Spinner } from '../ui/index.ts';

export const sessionQueryKey = ['session', 'me'] as const;

/**
 * Restores the signed-in user on app start by asking the API who the session cookie belongs to.
 * 401 means "signed out" (not an error). No OTP is ever sent from here.
 */
export function useSession() {
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: async (): Promise<CurrentUser | null> => {
      try {
        return await api<CurrentUser>('/auth/me');
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
    retry: (count, err) => !(err instanceof ApiRequestError && err.status < 500) && count < 2,
  });
}

/** Guards a surface: signed-out users go to that surface's sign-in; wrong roles see a clear message. */
export function RequireRole({
  role,
  signInPath,
  children,
}: {
  role: UserRole;
  signInPath: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const session = useSession();
  const location = useLocation();

  if (session.isPending) return <FullScreenLoader />;

  if (session.isError) {
    const offline = session.error instanceof ApiRequestError && session.error.isNetwork;
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <ErrorState
          offline={offline}
          title={offline ? t('errors.offlineTitle') : t('errors.genericTitle')}
          body={session.error.message}
          action={<Button onClick={() => session.refetch()}>{t('common.retry')}</Button>}
        />
      </div>
    );
  }

  if (!session.data) {
    return <Navigate to={signInPath} replace state={{ from: location.pathname }} />;
  }

  if (session.data.role !== role) {
    return <WrongArea signInPath={signInPath} />;
  }

  return children;
}

function WrongArea({ signInPath }: { signInPath: string }) {
  const { t } = useTranslation();
  const signOut = useSignOut(signInPath);
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <ErrorState
        title={t('errors.wrongAreaTitle')}
        body={t('errors.wrongAreaBody')}
        action={
          <Button variant="secondary" loading={signOut.isPending} onClick={() => signOut.mutate()}>
            {t('auth.switchAccount')}
          </Button>
        }
      />
    </div>
  );
}

/**
 * Revokes the session on the server, then forgets every cached query (other users' data must
 * never linger on a shared phone) and returns to the surface's sign-in screen.
 */
export function useSignOut(signInPath: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    // Only after the server confirms: if logout failed, the cookie would still restore the session.
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(sessionQueryKey, null);
      navigate(signInPath, { replace: true });
    },
  });
}

export function FullScreenLoader() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh items-center justify-center text-ink-3">
      <Spinner className="size-7" label={t('common.loading')} />
    </div>
  );
}

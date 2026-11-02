import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ADMIN_PASSWORD_MIN,
  formatPhone,
  type AdminSecurity,
  type OtpChallenge,
} from '@dp/shared';
import { api, ApiRequestError } from '../../lib/api.ts';
import { useSession } from '../../lib/session.tsx';
import { Button, Notice, Panel, TextField, useToast } from '../../ui/index.ts';

export function AdminSettings() {
  const { data: me } = useSession();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [mismatch, setMismatch] = useState(false);

  const change = useMutation({
    mutationFn: () =>
      api('/auth/admin/password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      }),
    onSuccess: () => {
      toast('Password changed. Other devices were signed out.', 'success');
      setCurrent('');
      setNext('');
      setRepeat('');
    },
  });
  const fields = change.error instanceof ApiRequestError ? change.error.fields : undefined;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (next !== repeat) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    change.mutate();
  };

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">Settings</h1>
        <p className="text-[15px] text-ink-2">Your staff account.</p>
      </div>

      <Panel className="divide-y divide-line">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <span className="text-sm text-ink-3">Name</span>
          <span className="font-medium">{me?.fullName ?? '—'}</span>
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <span className="text-sm text-ink-3">Phone</span>
          <span className="font-medium tabular">{me ? formatPhone(me.phone) : '—'}</span>
        </div>
      </Panel>

      <SecurityPanel />

      <Panel className="p-5">
        <h2 className="text-lg font-semibold">Change password</h2>
        <p className="mt-1 text-sm text-ink-3">
          At least {ADMIN_PASSWORD_MIN} characters. Changing it signs you out on every other device.
        </p>
        <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-4">
          <TextField
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            error={fields?.currentPassword}
            maxLength={200}
          />
          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            error={fields?.newPassword}
            maxLength={200}
          />
          <TextField
            label="Repeat new password"
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            error={mismatch ? 'The passwords do not match.' : undefined}
            maxLength={200}
          />
          {change.isError && !fields && <Notice tone="danger">{change.error.message}</Notice>}
          <div>
            <Button
              type="submit"
              loading={change.isPending}
              disabled={!current || !next || !repeat}
            >
              Change password
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

/** Recovery phone (verified by SMS code) and the 2-step sign-in switch. */
function SecurityPanel() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const security = useQuery({
    queryKey: ['admin', 'security'],
    queryFn: () => api<AdminSecurity>('/auth/admin/security'),
  });
  const [phone, setPhone] = useState('');
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [code, setCode] = useState('');
  const [editing, setEditing] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'security'] });

  const send = useMutation({
    mutationFn: () =>
      api<OtpChallenge>('/auth/admin/recovery-phone', { method: 'POST', body: { phone } }),
    onSuccess: (c) => {
      setChallenge(c);
      setCode('');
    },
  });
  const confirm = useMutation({
    mutationFn: () =>
      api('/auth/admin/recovery-phone/confirm', {
        method: 'POST',
        body: { challengeId: challenge!.challengeId, code },
      }),
    onSuccess: () => {
      toast('Phone number verified.', 'success');
      setChallenge(null);
      setEditing(false);
      setPhone('');
      void refresh();
    },
  });
  const twoStep = useMutation({
    mutationFn: (enabled: boolean) =>
      api('/auth/admin/two-step', { method: 'POST', body: { enabled } }),
    onSuccess: (_d, enabled) => {
      toast(enabled ? '2-step sign-in is on.' : '2-step sign-in is off.', 'success');
      void refresh();
    },
  });
  const s = security.data;
  const error = send.error ?? confirm.error ?? twoStep.error;

  return (
    <Panel className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-lg font-semibold">Phone for sign-in codes</h2>
        <p className="mt-1 text-sm text-ink-3">
          Used to reset your password if you forget it, and for 2-step sign-in.
        </p>
      </div>
      {s && (
        <p className="text-sm">
          Username: <span className="font-semibold">{s.username}</span>
        </p>
      )}

      {s?.recoveryPhone && !editing ? (
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-surface-2 px-4 py-3">
          <span>
            <span className="block text-xs text-ink-3">Verified phone</span>
            <span className="font-semibold tabular">{s.recoveryPhone}</span>
          </span>
          <Button variant="ghost" className="h-9 px-3 text-sm" onClick={() => setEditing(true)}>
            Change
          </Button>
        </div>
      ) : challenge ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-2">Enter the 6-digit code sent to {challenge.maskedPhone}.</p>
          {challenge.devCode && (
            <Notice tone="info">
              Test mode (no SMS sent). Code: <b className="font-mono tracking-widest">{challenge.devCode}</b>
            </Notice>
          )}
          <TextField
            label="Code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            autoFocus
          />
          <div className="flex gap-2">
            <Button onClick={() => confirm.mutate()} loading={confirm.isPending} disabled={code.length !== 6}>
              Verify
            </Button>
            <Button variant="ghost" onClick={() => setChallenge(null)}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <TextField
            label="Phone number"
            prefix="+251"
            type="tel"
            inputMode="tel"
            placeholder="91 123 4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <div className="flex gap-2">
            <Button onClick={() => send.mutate()} loading={send.isPending} disabled={phone.trim().length < 9}>
              Send code
            </Button>
            {editing && (
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}

      <label className="flex items-start gap-3 border-t border-line pt-4">
        <input
          type="checkbox"
          className="mt-1 size-5 accent-[var(--c-accent)]"
          checked={!!s?.twoStep}
          disabled={!s?.recoveryPhone || twoStep.isPending}
          onChange={(e) => twoStep.mutate(e.target.checked)}
        />
        <span>
          <span className="block font-semibold">2-step sign-in</span>
          <span className="block text-sm text-ink-3">
            {s?.recoveryPhone
              ? 'After your password, also enter a code sent to your phone.'
              : 'Verify a phone number above to turn this on.'}
          </span>
        </span>
      </label>

      {error && <Notice tone="danger">{(error as Error).message}</Notice>}
    </Panel>
  );
}

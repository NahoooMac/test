import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatPhone, type UserRole, type UserStatus } from '@dp/shared';
import { api } from '../../lib/api.ts';
import { useSession } from '../../lib/session.tsx';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Notice,
  Panel,
  Segmented,
  TextField,
  useToast,
} from '../../ui/index.ts';

interface AdminUser {
  id: string;
  phone: string;
  fullName: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
}

export function UsersAdmin() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: me } = useSession();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<AdminUser | null>(null);
  const [reason, setReason] = useState('');
  const [role, setRole] = useState<'all' | UserRole>('all');

  const users = useQuery({
    queryKey: ['admin', 'users', query],
    queryFn: () =>
      api<AdminUser[]>(`/admin/users${query ? `?q=${encodeURIComponent(query)}` : ''}`),
  });
  const change = useMutation({
    mutationFn: (v: { id: string; status: UserStatus }) =>
      api(`/admin/users/${v.id}/status`, { method: 'POST', body: { status: v.status, reason } }),
    onSuccess: (_d, v) => {
      toast(
        v.status === 'suspended'
          ? 'Account suspended and signed out everywhere.'
          : 'Account reinstated.',
        'success',
      );
      setTarget(null);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
  const next: UserStatus = target?.status === 'suspended' ? 'active' : 'suspended';

  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">Users</h1>
        <p className="text-[15px] text-ink-2">
          Find an account by phone or name. Suspending signs the person out on every device.
        </p>
      </div>
      <form
        className="flex items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
        }}
      >
        <TextField
          label="Search"
          className="w-80"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="0911… or name"
        />
        <Button type="submit" className="h-14">
          Search
        </Button>
      </form>

      {target && (
        <Panel className="flex flex-col gap-3 p-4">
          <p className="font-semibold">
            {next === 'suspended' ? 'Suspend' : 'Reinstate'}{' '}
            {target.fullName ?? formatPhone(target.phone)}
          </p>
          <TextField
            label="Reason (kept in the audit log)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            autoFocus
          />
          {change.isError && <Notice tone="danger">{change.error.message}</Notice>}
          <div className="flex gap-2">
            <Button
              variant={next === 'suspended' ? 'danger' : 'primary'}
              disabled={reason.trim().length < 3}
              loading={change.isPending}
              onClick={() => change.mutate({ id: target.id, status: next })}
            >
              Confirm
            </Button>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              Cancel
            </Button>
          </div>
        </Panel>
      )}

      <Segmented
        label="Filter by role"
        className="max-w-lg"
        value={role}
        onChange={setRole}
        options={[
          { value: 'all', label: 'All', count: users.data?.length },
          { value: 'customer', label: 'Customers', count: users.data?.filter((u) => u.role === 'customer').length },
          { value: 'rider', label: 'Riders', count: users.data?.filter((u) => u.role === 'rider').length },
          { value: 'admin', label: 'Admins', count: users.data?.filter((u) => u.role === 'admin').length },
        ]}
      />

      <DataTable<AdminUser>
        caption="Users"
        rows={(users.data ?? []).filter((u) => role === 'all' || u.role === role)}
        loading={users.isPending}
        rowKey={(u) => u.id}
        empty={<EmptyState title="No users found" />}
        columns={[
          {
            key: 'name',
            header: 'Name',
            cell: (u) => (
              <span className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent-soft-ink">
                  {(u.fullName ?? '?')
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((p) => p[0]!.toUpperCase())
                    .join('')}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    {u.fullName ?? <span className="text-ink-3">—</span>}
                  </span>
                  <span className="block text-xs text-ink-3 capitalize">{u.role}</span>
                </span>
              </span>
            ),
          },
          {
            key: 'phone',
            header: 'Phone',
            cell: (u) => <span className="tabular">{formatPhone(u.phone)}</span>,
          },
          {
            key: 'role',
            header: 'Role',
            cell: (u) => <Badge tone={u.role === 'admin' ? 'info' : 'neutral'}>{u.role}</Badge>,
          },
          {
            key: 'status',
            header: 'Status',
            cell: (u) => (
              <Badge tone={u.status === 'active' ? 'success' : 'danger'} dot>
                {u.status}
              </Badge>
            ),
          },
          {
            key: 'joined',
            header: 'Joined',
            cell: (u) => (
              <span className="text-ink-2">
                {new Date(u.createdAt).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            ),
          },
          {
            key: 'action',
            header: 'Actions',
            hideHeader: true,
            align: 'right',
            cell: (u) =>
              u.id === me?.id ? (
                <span className="text-xs text-ink-3">you</span>
              ) : (
                <Button
                  variant={u.status === 'active' ? 'secondary' : 'primary'}
                  className="h-9 px-3 text-sm"
                  onClick={() => {
                    setTarget(u);
                    setReason('');
                  }}
                >
                  {u.status === 'active' ? 'Suspend' : 'Reinstate'}
                </Button>
              ),
          },
        ]}
      />
    </div>
  );
}

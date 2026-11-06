import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Bell, CheckCircle2, CircleAlert } from 'lucide-react';
import type { AdminNotification, AdminNotifications } from '@dp/shared';
import { api } from '../../lib/api.ts';
import { pollEvery } from '../../lib/live.ts';
import { cn, useToast } from '../../ui/index.ts';

const SEEN_KEY = 'admin.notifications.seenAt';

function readSeen(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? '';
  } catch {
    return '';
  }
}

const ago = (iso: string) => {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return 'now';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
};

/**
 * Bell for delivery updates and things waiting for an admin. Live events refresh it at once;
 * polling covers the rest. New updates also pop up as a toast while the page is open.
 */
export function NotificationsBell() {
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState(readSeen);
  const box = useRef<HTMLDivElement>(null);
  const feed = useQuery({
    queryKey: ['admin', 'notifications'],
    queryFn: () => api<AdminNotifications>('/admin/notifications'),
    refetchInterval: () => pollEvery(15_000, 30_000),
  });
  const items = feed.data?.items ?? [];
  const unread = items.filter((n) => n.at > seenAt).length;

  // Toast what arrived since the last refresh (not the backlog on first load).
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!feed.data) return;
    const ids = new Set(feed.data.items.map((n) => n.id));
    if (known.current) {
      const fresh = feed.data.items.filter((n) => !known.current!.has(n.id));
      for (const n of fresh.slice(0, 2)) toast(n.title, n.needsAction ? 'info' : 'success');
    }
    known.current = ids;
  }, [feed.data, toast]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const toggle = () => {
    if (!open && items[0]) {
      setSeenAt(items[0].at);
      try {
        localStorage.setItem(SEEN_KEY, items[0].at);
      } catch {
        // storage blocked: the count just resets on reload
      }
    }
    setOpen(!open);
  };
  const go = (n: AdminNotification) => {
    setOpen(false);
    navigate(n.link);
  };

  return (
    <div ref={box} className="fixed top-2 right-3 z-30 lg:top-4 lg:right-6">
      <button
        type="button"
        onClick={toggle}
        aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}
        aria-expanded={open}
        className="relative flex size-10 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-[var(--shadow-sm)] hover:bg-surface-2"
      >
        <Bell className="size-5" aria-hidden />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-bold text-white tabular">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute top-12 right-0 flex max-h-[70vh] w-[min(23rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-[var(--shadow-xl)]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="font-semibold">Notifications</p>
            {!!feed.data?.actionCount && (
              <span className="text-xs font-semibold text-warning">{feed.data.actionCount} need action</span>
            )}
          </div>
          <ul className="divide-y divide-line overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-3">Nothing yet.</li>}
            {items.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => go(n)} className="flex w-full gap-3 px-4 py-3 text-left hover:bg-surface-2">
                  {n.needsAction ? (
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  ) : (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-sm', n.needsAction ? 'font-semibold' : 'font-medium')}>{n.title}</span>
                    {n.body && <span className="block truncate text-xs text-ink-3">{n.body}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-ink-3 tabular">{ago(n.at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

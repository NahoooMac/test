import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, WifiOff } from 'lucide-react';
import { cn } from './cn.ts';

export function EmptyState({
  title,
  body,
  action,
  icon,
  className,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-10 text-center', className)}>
      <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-surface-2 text-ink-2">
        {icon ?? <Inbox className="size-6" aria-hidden />}
      </span>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-ink-2">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title,
  body,
  action,
  offline,
  className,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  offline?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center px-6 py-10 text-center', className)}
    >
      <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-danger-soft text-danger">
        {offline ? (
          <WifiOff className="size-6" aria-hidden />
        ) : (
          <AlertTriangle className="size-6" aria-hidden />
        )}
      </span>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-ink-2">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Inline message inside forms and sheets. */
export function Notice({
  tone = 'info',
  children,
  className,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    info: 'bg-info-soft text-info',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    success: 'bg-success-soft text-success',
  };
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-xl px-4 py-3 text-sm font-medium', tones[tone], className)}
    >
      {children}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('block animate-pulse rounded-lg bg-surface-2', className)} />
  );
}

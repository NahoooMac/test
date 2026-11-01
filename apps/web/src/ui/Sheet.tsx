import type { ReactNode } from 'react';
import { cn } from './cn.ts';

/**
 * Bottom sheet that sits over a full-screen map on mobile. Static in Phase 2;
 * drag-to-expand arrives with the map screens in Phase 4.
 */
export function Sheet({
  children,
  footer,
  className,
  label,
}: {
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        'rounded-t-[var(--radius-2xl)] border-t border-line bg-surface shadow-[var(--shadow-xl)]',
        className,
      )}
    >
      <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line-strong" />
      <div className="px-4 pt-3 pb-4">{children}</div>
      {footer && <div className="border-t border-line px-4 pt-3 pb-safe">{footer}</div>}
    </section>
  );
}

/** Card surface for grouped content. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-lg)] border border-line bg-surface shadow-[var(--shadow-xs)]',
        className,
      )}
    >
      {children}
    </div>
  );
}
